import { LinghunError } from "@linghun/core";
import { LINGHUN_CLI_NAME, LINGHUN_NAME, LINGHUN_VERSION } from "@linghun/shared";
import { describe, expect, it, vi } from "vitest";
import {
  DeepSeekProvider,
  GeminiProvider,
  GrokProvider,
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
  repairToolMessagePairing,
  resolveAnthropicContextEditingDiagnostic,
  resolveEffectiveEndpointProfile,
  resolveProviderBaseUrlDiagnostic,
  resolveProviderRuntimeContract,
} from "./index.js";

const EXPECTED_REQUEST_USER_AGENT = `${LINGHUN_NAME}/${LINGHUN_VERSION} (@linghun/${LINGHUN_CLI_NAME})`;

describe("Gemini and Grok native gateways", () => {
  it("uses Gemini chat hosted search with custom tools and reasoning", () => {
    const provider = new GeminiProvider({
      id: "gemini",
      type: "gemini",
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "test-key",
      model: "gemini-3.5-flash",
      endpointProfile: "chat_completions",
      reasoningLevel: "Medium",
    });

    const contract = resolveProviderRuntimeContract({
      id: "gemini",
      type: "gemini",
      model: "gemini-3.5-flash",
      endpointProfile: "chat_completions",
      reasoningLevel: "Medium",
    });
    const request = provider.createChatRequest({
      messages: [{ role: "user", content: "Search the web." }],
      tools: [
        { name: "WebSearch", description: "Local search", inputSchema: { type: "object" } },
        { name: "Read", description: "Read", inputSchema: { type: "object" } },
      ],
    });

    expect(contract.profile).toBe("gemini_chat_completions");
    expect(contract.sendReasoning).toBe(true);
    expect(request.reasoning).toEqual({ effort: "medium" });
    expect(request.tools?.at(-1)).toEqual({ type: "web_search_preview" });
    expect(request.tools).not.toContainEqual(
      expect.objectContaining({ function: expect.objectContaining({ name: "WebSearch" }) }),
    );
  });

  it("uses Grok Responses search without sending rejected reasoning fields", () => {
    const provider = new GrokProvider({
      id: "grok",
      type: "grok",
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "test-key",
      model: "grok-4.20-reasoning",
      reasoningLevel: "High",
    });

    const contract = resolveProviderRuntimeContract({
      id: "grok",
      type: "grok",
      model: "grok-4.20-reasoning",
      reasoningLevel: "High",
    });
    const request = provider.createResponsesRequest({
      messages: [{ role: "user", content: "Search the web." }],
      tools: [
        { name: "WebSearch", description: "Local search", inputSchema: { type: "object" } },
        { name: "Read", description: "Read", inputSchema: { type: "object" } },
      ],
    });

    expect(contract.profile).toBe("grok_responses");
    expect(contract.sendReasoning).toBe(false);
    expect(request).not.toHaveProperty("reasoning");
    expect(request.tools?.at(-1)).toEqual({ type: "web_search", external_web_access: true });
    expect(request.tools).not.toContainEqual(expect.objectContaining({ name: "WebSearch" }));
  });

  it.each([
    {
      name: "Gemini",
      provider: new GeminiProvider({
        id: "gemini",
        type: "gemini",
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "test-key",
        model: "gemini-3.5-flash",
      }),
      expectedUrl: "https://gateway.example.com/v1/chat/completions",
      sse: 'data: {"id":"gemini-1","choices":[{"delta":{"content":"gemini"}}]}\n\ndata: [DONE]\n\n',
      expectedEvent: { type: "assistant_text_delta", id: "gemini-1", text: "gemini" },
    },
    {
      name: "Grok",
      provider: new GrokProvider({
        id: "grok",
        type: "grok",
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "test-key",
        model: "grok-4.20-reasoning",
      }),
      expectedUrl: "https://gateway.example.com/v1/responses",
      sse: 'data: {"id":"grok-1","type":"response.output_text.delta","delta":"grok"}\n\ndata: [DONE]\n\n',
      expectedEvent: { type: "assistant_text_delta", id: "grok-1", text: "grok" },
    },
  ])("streams $name through the shared OpenAI SSE parser branch", async (testCase) => {
    const fetchMock = vi.fn(async (_url: string) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(testCase.sse));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const events: LinghunEvent[] = [];

    for await (const event of testCase.provider.stream({
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(testCase.expectedUrl);
    expect(events).toContainEqual(testCase.expectedEvent);
  });
});

describe("DeepSeek model capabilities", () => {
  it("records real DeepSeek API model names", () => {
    const chat = deepSeekModels.find((model) => model.id === "deepseek-chat");
    const reasoner = deepSeekModels.find((model) => model.id === "deepseek-reasoner");

    expect(chat?.displayName).toBe("DeepSeek Chat");
    expect(chat?.contextWindow).toBe(200_000);
    expect(chat?.maxOutputTokens).toBe(8_192);
    expect(reasoner?.displayName).toBe("DeepSeek Reasoner");
    expect(reasoner?.contextWindow).toBe(64_000);
    expect(reasoner?.maxOutputTokens).toBe(8_192);
    expect(deepSeekModels.map((model) => model.id)).not.toContain("deepseek-v4-pro");
    expect(deepSeekModels.map((model) => model.id)).not.toContain("deepseek-v4-flash");
  });

  it("maps legacy DeepSeek display aliases to real API models before request body", () => {
    const provider = new DeepSeekProvider({ model: "deepseek-v4-pro", apiKey: "test-key" });

    const request = provider.createChatRequest({
      messages: [{ role: "user", content: "你好" }],
    });

    expect(request.model).toBe("deepseek-reasoner");
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
    });

    const request = provider.createChatRequest({
      messages: [{ role: "user", content: "你好" }],
    });

    expect(request).toEqual({
      model: "custom-model",
      messages: [{ role: "user", content: "你好" }],
      stream: true,
      max_tokens: 16_384,
    });
  });

  it("sends chat max_tokens with explicit config, defaults 16384 when not configured", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "custom-model",
    });

    const request = provider.createChatRequest({
      messages: [{ role: "user", content: "你好" }],
      maxOutputTokens: 4_000,
    });

    expect(request.max_tokens).toBe(4_000);

    const defaulted = provider.createChatRequest({
      messages: [{ role: "user", content: "你好" }],
    });
    expect(defaulted.max_tokens).toBe(16_384);
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
    expect(request.web_search_options).toEqual({});
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

  it("repairs OpenAI chat tool continuation before sending provider requests", () => {
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
          toolCalls: [
            { id: "call-1", name: "Read", input: { path: "README.md" } },
            { id: "bad id", name: "Read", input: {} },
          ],
        },
        { role: "tool", tool_call_id: "call-ghost", content: "orphan" },
      ],
    });

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
      {
        role: "tool",
        tool_call_id: "call-1",
        content:
          '{"ok":false,"text":"missing tool_result; synthesized by Linghun before provider request","isError":true}',
      },
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

    expect(request.reasoning).toEqual({ effort: "medium" });
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
      max_output_tokens: 16_384,
      tools: [
        {
          type: "function",
          name: "Read",
          description: "Read a file",
          parameters: { type: "object" },
        },
        { type: "web_search", external_web_access: true },
      ],
      tool_choice: "auto",
      reasoning: { effort: "medium" },
    });
  });

  it("normalizes OpenAI reasoning effort to lowercase for responses gateways", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-5.5",
      endpointProfile: "responses",
      reasoningLevel: "High",
    });

    const request = provider.createResponsesRequest({
      messages: [{ role: "user", content: "你好" }],
    });

    expect(request.reasoning).toEqual({ effort: "high" });
  });

  it("can disable parallel tool calls for Responses compatibility retries without dropping reasoning", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-5.5",
      endpointProfile: "responses",
      reasoningLevel: "High",
    });

    const request = provider.createResponsesRequest({
      messages: [{ role: "user", content: "你好" }],
      tools: [{ name: "Read", description: "Read a file", inputSchema: { type: "object" } }],
      toolChoice: "auto",
      parallelToolCalls: false,
    });

    expect(request.reasoning).toEqual({ effort: "high" });
    expect(request.parallel_tool_calls).toBe(false);
    expect(request.tools).toHaveLength(2);
    expect(request.tools?.at(-1)).toEqual({ type: "web_search", external_web_access: true });
  });

  it("adds hosted web search to Responses tool schemas", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-5.5",
      endpointProfile: "responses",
    });

    const request = provider.createResponsesRequest({
      messages: [{ role: "user", content: "search current docs" }],
      tools: [{ name: "Read", description: "Read a file", inputSchema: { type: "object" } }],
    });

    expect(request.tools).toEqual([
      {
        type: "function",
        name: "Read",
        description: "Read a file",
        parameters: { type: "object" },
      },
      { type: "web_search", external_web_access: true },
    ]);
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

  it("repairs responses function_call_output pairing before sending provider requests", () => {
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
          toolCalls: [
            { id: "call-1", name: "Read", input: { path: "README.md" } },
            { id: "call-1", name: "Grep", input: { pattern: "x" } },
          ],
        },
      ],
    });

    expect(request.input).toEqual([
      {
        type: "function_call",
        call_id: "call-1",
        name: "Read",
        arguments: '{"path":"README.md"}',
      },
      {
        type: "function_call_output",
        call_id: "call-1",
        output:
          '{"ok":false,"text":"missing tool_result; synthesized by Linghun before provider request","isError":true}',
      },
    ]);
  });

  it("repairs DeepSeek chat continuations through the OpenAI-compatible path", () => {
    const provider = new DeepSeekProvider({ model: "deepseek-reasoner", apiKey: "test-key" });

    const request = provider.createChatRequest({
      messages: [
        { role: "tool", tool_call_id: "orphan", content: "bad" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "deepseek-call-1", name: "Read", input: { path: "README.md" } }],
        },
      ],
    });

    expect(request.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "deepseek-call-1",
            type: "function",
            function: { name: "Read", arguments: '{"path":"README.md"}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "deepseek-call-1",
        content:
          '{"ok":false,"text":"missing tool_result; synthesized by Linghun before provider request","isError":true}',
      },
    ]);
  });

  it("reports tool pairing issues for request boundary diagnostics", () => {
    const result = repairToolMessagePairing([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-1", name: "Read", input: {} },
          { id: "call-1", name: "Read", input: {} },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "ok" },
      { role: "tool", tool_call_id: "call-1", content: "dup" },
      { role: "tool", tool_call_id: "ghost", content: "orphan" },
    ]);

    expect(result.issues).toContain("duplicate_tool_call_id");
    expect(result.issues).toContain("orphan_tool_result");
    expect(result.messages).toHaveLength(2);
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
      maxAttempts: 10,
      requestTimeoutMs: 600_000,
      streamIdleTimeoutMs: 60_000,
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
      expect(typeof body.stream).toBe("boolean");
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).stream).toBe(false);
  });

  it("uses an internal abort signal when streaming without caller signal", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"id":"resp-1","type":"response.output_text.delta","delta":"OK"}\n\n',
            ),
          );
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
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

    const events: LinghunEvent[] = [];
    for await (const event of provider.stream({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "assistant_text_delta", id: "resp-1", text: "OK" });
  });

  it.each([
    ["https://example.com/v1", "chat_completions", "https://example.com/v1/chat/completions"],
    ["https://example.com/v1", "responses", "https://example.com/v1/responses"],
    ["https://api.example.com/v1", "responses", "https://api.example.com/v1/responses"],
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
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
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
      await vi.advanceTimersByTimeAsync(600_000);
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
      await vi.advanceTimersByTimeAsync(600_000);
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
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
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
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
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

    expect(request.max_tokens).toBe(8_192);
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

    expect(models[0]?.id).toBe("deepseek-reasoner");
    expect(models[0]?.contextWindow).toBe(64_000);
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
  it("cancels the stream reader when the consumer stops after a parser error", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {bad json}\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });

    for await (const event of parseOpenAiStream(body)) {
      expect(event.type).toBe("error");
      break;
    }

    expect(cancelled).toBe(true);
  });

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

  it("parses OpenAI SSE events by block and preserves Markdown newlines", async () => {
    const markdown = "标题\n\n- 第一项\n- 第二项\n\n```ts\nconst x = 1;\n```";
    const payload = JSON.stringify({
      id: "chatcmpl-markdown",
      choices: [{ delta: { content: markdown } }],
    });
    const events = await collectOpenAiEvents([
      `event: completion\r\ndata: ${payload}\r\n\r\n`,
      "data: [DONE]\r\n\r\n",
    ]);

    expect(events).toContainEqual({
      type: "assistant_text_delta",
      id: "chatcmpl-markdown",
      text: markdown,
    });
  });

  it("combines multi-line OpenAI SSE data fields before JSON parsing", async () => {
    const events = await collectOpenAiEvents([
      "event: completion\n",
      'data: {"id":"chatcmpl-multidata",\n',
      'data: "choices":[{"delta":{"content":"AB"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    expect(events).toContainEqual({
      type: "assistant_text_delta",
      id: "chatcmpl-multidata",
      text: "AB",
    });
    expect(events.some((event) => event.type === "error")).toBe(false);
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

  it("returns a recoverable error when OpenAI SSE buffer grows without separators", async () => {
    const events = await collectOpenAiEvents([`data: ${"x".repeat(1_000_001)}`]);

    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "PROVIDER_STREAM_LIMIT_EXCEEDED" }),
      }),
    ]);
  });

  it("returns a recoverable error when OpenAI streamed tool arguments exceed the limit", async () => {
    const events = await collectOpenAiEvents([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  id: "call-large",
                  function: { name: "Read", arguments: `{"path":"${"x".repeat(1_000_001)}` },
                },
              ],
            },
          },
        ],
      })}\n\n`,
    ]);

    expect(events[0]).toMatchObject({
      type: "error",
      error: expect.objectContaining({ code: "PROVIDER_STREAM_LIMIT_EXCEEDED" }),
    });
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

  it("DeepSeek reasoning_content multi-chunk thinking-only yields assistant_thinking_delta, not text", async () => {
    const events = await collectOpenAiEvents([
      'data: {"id":"chatcmpl-ds","choices":[{"delta":{"reasoning_content":"Let me think about this..."}}]}\n\n',
      'data: {"id":"chatcmpl-ds","choices":[{"delta":{"reasoning_content":" The answer involves..."}}]}\n\n',
      'data: {"id":"chatcmpl-ds","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const thinkingEvents = events.filter((e) => e.type === "assistant_thinking_delta");
    const textEvents = events.filter((e) => e.type === "assistant_text_delta");
    expect(thinkingEvents).toHaveLength(2);
    expect(thinkingEvents[0]).toEqual({
      type: "assistant_thinking_delta",
      id: "chatcmpl-ds",
      text: "Let me think about this...",
    });
    expect(thinkingEvents[1]).toEqual({
      type: "assistant_thinking_delta",
      id: "chatcmpl-ds",
      text: " The answer involves...",
    });
    expect(textEvents).toHaveLength(0);
    const stop = events.find((e) => e.type === "message_stop");
    expect(stop).toEqual({
      type: "message_stop",
      id: "chatcmpl-ds",
      finishReason: "stop",
      chunkCount: 3,
      hadUsage: false,
    });
  });

  it("DeepSeek reasoning_content followed by content yields both thinking and text events", async () => {
    const events = await collectOpenAiEvents([
      'data: {"id":"chatcmpl-ds2","choices":[{"delta":{"reasoning_content":"thinking first"}}]}\n\n',
      'data: {"id":"chatcmpl-ds2","choices":[{"delta":{"content":"final answer"}}]}\n\n',
      'data: {"id":"chatcmpl-ds2","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const thinkingEvents = events.filter((e) => e.type === "assistant_thinking_delta");
    const textEvents = events.filter((e) => e.type === "assistant_text_delta");
    expect(thinkingEvents).toHaveLength(1);
    expect(thinkingEvents[0]).toEqual({
      type: "assistant_thinking_delta",
      id: "chatcmpl-ds2",
      text: "thinking first",
    });
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0]).toEqual({
      type: "assistant_text_delta",
      id: "chatcmpl-ds2",
      text: "final answer",
    });
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
    expect(events[3]).toMatchObject({
      type: "error",
      error: { code: "PROVIDER_RESPONSE_FAILED", recoverable: true },
    });
  });

  it("maps response.incomplete to a structured recoverable failure", async () => {
    const events = await collectOpenAiEvents(
      [
        `data: ${JSON.stringify({ type: "response.incomplete" })}\n\n`,
        "data: [DONE]\n\n",
      ],
      "/v1/responses",
    );

    expect(events[0]).toMatchObject({
      type: "error",
      error: {
        code: "PROVIDER_RESPONSE_INCOMPLETE",
        recoverable: true,
      },
    });
  });

  it("converts Responses cache write usage fields for compatible providers", async () => {
    const events = await collectOpenAiEvents(
      [
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp-cache",
            usage: {
              input_tokens: 20,
              output_tokens: 3,
              total_tokens: 23,
              input_tokens_details: { cached_tokens: 11, cache_creation_tokens: 5 },
            },
          },
        })}\n\n`,
        "data: [DONE]\n\n",
      ],
      "/v1/responses",
    );

    const usage = events.find(
      (event): event is Extract<LinghunEvent, { type: "usage" }> => event.type === "usage",
    );
    expect(usage?.usage.cacheReadTokens).toBe(11);
    expect(usage?.usage.cacheWriteTokens).toBe(5);
    expect(usage?.usage.endpoint).toBe("/v1/responses");
  });

  it("uses Responses completed message text when the gateway omits output_text deltas", async () => {
    const events = await collectOpenAiEvents(
      [
        `data: ${JSON.stringify({ type: "response.output_item.done", item: { id: "msg-1", type: "message", content: [{ type: "output_text", text: "final from done" }] } })}\n\n`,
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp-1", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, output: [{ type: "message", content: [{ type: "output_text", text: "final from completed" }] }] } })}\n\n`,
        "data: [DONE]\n\n",
      ],
      "/v1/responses",
    );

    expect(events).toContainEqual({
      type: "assistant_text_delta",
      id: "msg-1",
      text: "final from done",
    });
    expect(events.filter((event) => event.type === "assistant_text_delta")).toHaveLength(1);
  });

  it("uses Responses completed message text even when the gateway omits usage", async () => {
    const events = await collectOpenAiEvents(
      [
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp-1", output: [{ type: "message", content: [{ type: "output_text", text: "final without usage" }] }] } })}\n\n`,
        "data: [DONE]\n\n",
      ],
      "/v1/responses",
    );

    expect(events).toContainEqual({
      type: "assistant_text_delta",
      id: "resp-1",
      text: "final without usage",
    });
    expect(events.some((event) => event.type === "usage")).toBe(false);
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

  it("emits recoverable error when the stream closes before [DONE] or finish_reason", async () => {
    const events = await collectOpenAiEvents([
      'data: {"id":"chatcmpl-early","choices":[{"delta":{"content":"partial"}}]}\n\n',
    ]);

    expect(events).toEqual([
      { type: "assistant_text_delta", id: "chatcmpl-early", text: "partial" },
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "PROVIDER_STREAM_ERROR", recoverable: true }),
      }),
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

  it("normalizes eventstream CRC mismatch as provider stream decode error", async () => {
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
        throw new Error(
          "Anthropic Messages stream decode failed: eventstream prelude CRC mismatch sk-secret123",
        );
      },
    };
    const gateway = new ModelGateway([provider]);
    const events: LinghunEvent[] = [];

    for await (const event of gateway.stream(
      "mock",
      { messages: [{ role: "user", content: "hi" }] },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({
      type: "error",
      error: { code: "PROVIDER_STREAM_DECODE_ERROR", recoverable: true },
    });
    expect(JSON.stringify(events[0])).not.toContain("sk-secret123");
  });

  it("redacts secret fragments from generic provider errors", () => {
    const error = normalizeProviderError(new Error("upstream leaked sk-secret123 in message"));

    expect(error.code).toBe("PROVIDER_ERROR");
    expect(error.message).toContain("sk-***");
    expect(error.message).not.toContain("sk-secret123");
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
      code: "PROVIDER_QUOTA_EXHAUSTED",
    });
    await expect(collect()).rejects.not.toMatchObject({
      message: expect.stringMatching(/sk-test-secret|C:\/Users|prompt text/),
      suggestion: expect.stringMatching(/sk-test-secret|C:\/Users|prompt text/),
    });
  });

  it("classifies plain HTTP 429 as rate limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Too many requests: rate limit reached", {
            status: 429,
            headers: { "retry-after": "0" },
          }),
      ),
    );
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
      code: "PROVIDER_RATE_LIMITED",
      message: expect.stringContaining("HTTP 429"),
      suggestion: expect.stringContaining("降低请求频率"),
    });
    await expect(collect()).rejects.not.toMatchObject({
      code: "PROVIDER_QUOTA_EXHAUSTED",
    });
  });

  it("classifies HTTP 429 quota or balance exhaustion separately without leaking body details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '{"error":{"message":"insufficient_quota account balance too low sk-test-secret C:/Users/Admin/project prompt text"}}',
            { status: 429, headers: { "retry-after": "0" } },
          ),
      ),
    );
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
      code: "PROVIDER_QUOTA_EXHAUSTED",
      message: expect.stringContaining("HTTP 429"),
      suggestion: expect.stringContaining("Linghun 没有查询余额"),
    });
    await expect(collect()).rejects.not.toMatchObject({
      message: expect.stringMatching(/sk-test-secret|C:\/Users|prompt text/),
      suggestion: expect.stringMatching(/sk-test-secret|C:\/Users|prompt text/),
    });
  });

  it("classifies HTTP 402 payment or billing exhaustion as quota exhausted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("payment required billing limit reached balance exhausted sk-test-secret", {
            status: 402,
          }),
      ),
    );
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
      code: "PROVIDER_QUOTA_EXHAUSTED",
      message: expect.stringContaining("HTTP 402"),
      suggestion: expect.stringContaining("充值或检查账单"),
    });
    await expect(collect()).rejects.not.toMatchObject({
      message: expect.stringMatching(/sk-test-secret/),
      suggestion: expect.stringMatching(/sk-test-secret/),
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
  }, 10_000);
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

  it("Fix A: Claude + config endpointProfile=anthropic_messages + request endpointProfile=chat_completions placeholder → stays anthropic_messages, source != request", () => {
    // 复现 root cause：用户 provider.env 已经显式声明 anthropic_messages，
    // 但 TUI SelectedModelRuntime narrow 把 chat_completions 当 placeholder 透传给 gateway.stream。
    // 决策器必须把这种 placeholder 视为占位，不能让 request.chat_completions 把
    // config.anthropic_messages 翻盘成 OpenAI chat。
    const result = resolveEffectiveEndpointProfile({
      requestEndpointProfile: "chat_completions",
      configEndpointProfile: "anthropic_messages",
      configBaseUrl: "https://relay.example.com",
      configModel: "claude-opus-4-7",
      requestModel: "claude-opus-4-7",
    });
    expect(result.endpointProfile).toBe("anthropic_messages");
    expect(result.source).not.toBe("request");
    // 既然 baseUrl 没有 /v1/messages 后缀也没有 chat_completions/responses 后缀，
    // 决策应落到 config-explicit（用户 provider.env 显式声明）。
    expect(result.source).toBe("config-explicit");
  });

  it("Fix A: Claude + config endpointProfile=responses + request endpointProfile=chat_completions placeholder → stays responses, source != request", () => {
    // 同上 placeholder 路径但 config 是 responses；request.chat_completions 不能翻盘成 chat。
    const result = resolveEffectiveEndpointProfile({
      requestEndpointProfile: "chat_completions",
      configEndpointProfile: "responses",
      configBaseUrl: "https://relay.example.com/v1",
      configModel: "claude-opus-4-7",
      requestModel: "claude-opus-4-7",
    });
    expect(result.endpointProfile).toBe("responses");
    expect(result.source).not.toBe("request");
  });

  it("Fix A: non-Claude model + request endpointProfile=chat_completions still honors request explicitly", () => {
    // 反向回归：占位策略只对 Claude 生效；非 Claude 显式 request.chat_completions 仍按 request 生效。
    const result = resolveEffectiveEndpointProfile({
      requestEndpointProfile: "chat_completions",
      configEndpointProfile: "anthropic_messages",
      configBaseUrl: "https://api.openai.com/v1",
      configModel: "gpt-4o-mini",
      requestModel: "gpt-4o-mini",
    });
    expect(result.endpointProfile).toBe("chat_completions");
    expect(result.source).toBe("request");
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
    expect(joinBaseUrlAndEndpoint("https://relay.example.com", "/v1/messages")).toBe(
      "https://relay.example.com/v1/messages",
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

  it("does not add /v1 to OpenAI-compatible root baseUrl automatically", () => {
    expect(joinBaseUrlAndEndpoint("https://relay.example.com", "/chat/completions")).toBe(
      "https://relay.example.com/chat/completions",
    );
    expect(joinBaseUrlAndEndpoint("https://relay.example.com", "/responses")).toBe(
      "https://relay.example.com/responses",
    );
  });

  it("works alongside diagnostic normalization: full anthropic endpoint baseUrl resolves to single /v1/messages", () => {
    // 用户把完整 endpoint 写进 baseUrl：先经 resolveProviderBaseUrlDiagnostic 剥掉 /v1/messages，
    // 再用 joinBaseUrlAndEndpoint 拼回去，确保不会变成 /v1/v1/messages 或丢路径。
    const diagnostic = resolveProviderBaseUrlDiagnostic(
      "https://relay.example.com/v1/messages",
      "anthropic_messages",
    );
    const url = joinBaseUrlAndEndpoint(diagnostic.normalizedBaseUrl, "/v1/messages");
    expect(url).toBe("https://relay.example.com/v1/messages");
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

  it("adds Anthropic server-side web search to tool schemas", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-opus-4-6",
      endpointProfile: "anthropic_messages",
    });

    const request = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "search current docs" }],
      tools: [{ name: "Read", description: "Read a file", inputSchema: { type: "object" } }],
    });

    expect(request.tools).toEqual([
      {
        name: "Read",
        description: "Read a file",
        input_schema: { type: "object" },
      },
      { type: "web_search_20250305", name: "web_search", max_uses: 8 },
    ]);
  });

  it("routes explicit DeepSeek Anthropic-compatible requests through the search endpoint", () => {
    const provider = new DeepSeekProvider({
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-pro",
      endpointProfile: "anthropic_messages",
    });
    const contract = resolveProviderRuntimeContract({
      id: "deepseek",
      type: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-pro",
      endpointProfile: "anthropic_messages",
    });

    const request = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "search current docs" }],
      tools: [{ name: "Read", description: "Read a file", inputSchema: { type: "object" } }],
    });

    expect(contract.profile).toBe("deepseek_anthropic_messages");
    expect(contract.endpoint).toBe("/anthropic/v1/messages");
    expect(request.model).toBe("deepseek-v4-pro");
    expect(request.tools?.at(-1)).toEqual({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 8,
    });
  });
});

describe("Anthropic Messages stream parser", () => {
  it("cancels the stream reader when the consumer stops after a parser error", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: message_start\ndata: {bad json}\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });

    for await (const event of parseAnthropicMessagesStream(body)) {
      expect(event.type).toBe("error");
      break;
    }

    expect(cancelled).toBe(true);
  });

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

  it("parses CRLF-delimited Anthropic SSE events split across chunks", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\r\ndata: {"type":"message_start","message":{"id":"msg_crlf"}}\r\n\r\n',
      'event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"he',
      'llo"}}\r\n\r\n',
      'event: message_stop\r\ndata: {"type":"message_stop"}\r\n\r\n',
    ]);

    const text = events
      .filter(
        (event): event is Extract<LinghunEvent, { type: "assistant_text_delta" }> =>
          event.type === "assistant_text_delta",
      )
      .map((event) => event.text)
      .join("");
    expect(text).toBe("hello");
    expect(events.at(-1)).toMatchObject({ type: "message_stop", id: "msg_crlf" });
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

  it("returns a recoverable error when Anthropic SSE buffer grows without separators", async () => {
    const events = await collectAnthropicEvents([`data: ${"x".repeat(1_000_001)}`]);

    expect(events[0]).toMatchObject({
      type: "error",
      error: expect.objectContaining({ code: "PROVIDER_STREAM_LIMIT_EXCEEDED" }),
    });
  });

  it("returns a recoverable error when one Anthropic SSE event exceeds the limit", async () => {
    const events = await collectAnthropicEvents([
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "x".repeat(1_000_001) },
      })}\n\n`,
    ]);

    expect(events[0]).toMatchObject({
      type: "error",
      error: expect.objectContaining({ code: "PROVIDER_STREAM_LIMIT_EXCEEDED" }),
    });
  });

  it("returns a recoverable error when Anthropic tool arguments exceed the limit", async () => {
    const events = await collectAnthropicEvents([
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read"}}\n\n',
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: `{"path":"${"x".repeat(1_000_001)}` },
      })}\n\n`,
    ]);

    expect(events[0]).toMatchObject({
      type: "error",
      error: expect.objectContaining({ code: "PROVIDER_STREAM_LIMIT_EXCEEDED" }),
    });
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
    expect(body.tools?.map((tool) => tool.name)).toEqual(["Bash", "Read", "web_search"]);
    // tools 走 Anthropic 原生 schema：{name, description, input_schema}，
    // 而不是 OpenAI 的 {type:"function", function:{...}} 包装。
    expect(body.tools?.[0]).toMatchObject({
      name: "Bash",
      description: "Run bash",
      input_schema: { type: "object" },
    });
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("can disable parallel tool use for anthropic_messages compatibility retries without dropping reasoning", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
      reasoningLevel: "High",
    });
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "Read", description: "Read file", inputSchema: { type: "object" } }],
      parallelToolCalls: false,
    });

    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(body.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
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

  it("adds prompt cache markers to the latest Anthropic user message", () => {
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
      ],
      promptCacheEnabled: true,
    });

    expect(body.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }],
      },
    ]);
    expect(body.system).toEqual([
      { type: "text", text: "You are Linghun.", cache_control: { type: "ephemeral" } },
    ]);
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

  it("D.13L: adds Anthropic tool schema cache_control only when prompt cache is enabled", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
    });

    const cached = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "stable system" },
        { role: "user", content: "hi" },
      ],
      promptCacheEnabled: true,
      promptCacheTtl: "1h",
      tools: [
        { name: "Read", description: "Read file", inputSchema: { type: "object" } },
        { name: "Bash", description: "Run command", inputSchema: { type: "object" } },
      ],
      toolChoice: "auto",
    });

    expect(cached.tools?.map((tool) => tool.name)).toEqual(["Bash", "Read", "web_search"]);
    expect(cached.tools?.[0]).toMatchObject({
      name: "Bash",
      input_schema: { type: "object" },
    });
    expect(cached.tools?.[0].cache_control).toBeUndefined();
    expect(cached.tools?.[1]).toMatchObject({
      name: "Read",
      input_schema: { type: "object" },
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
    expect(cached.tools?.[2]).toEqual({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 8,
    });

    const uncached = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
      promptCacheEnabled: false,
      tools: [{ name: "Read", description: "Read file", inputSchema: { type: "object" } }],
    });
    expect(uncached.tools?.[0].cache_control).toBeUndefined();
  });

  it("D.13L: keeps Anthropic cache_control on the stable tool boundary before dynamic tools", () => {
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
      promptCacheEnabled: true,
      tools: [
        { name: "skill__notes", description: "Skill", inputSchema: { type: "object" } },
        { name: "Read", description: "Read file", inputSchema: { type: "object" } },
        { name: "mcp__search", description: "MCP search", inputSchema: { type: "object" } },
        { name: "Bash", description: "Run command", inputSchema: { type: "object" } },
        { name: "plugin__deploy", description: "Plugin", inputSchema: { type: "object" } },
      ],
    });

    expect(body.tools?.map((tool) => tool.name)).toEqual([
      "Bash",
      "Read",
      "mcp__search",
      "plugin__deploy",
      "skill__notes",
      "web_search",
    ]);
    expect(body.tools?.map((tool) => tool.cache_control)).toEqual([
      undefined,
      { type: "ephemeral" },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("keeps stable Anthropic tool base bytes while cache_control overlay can change", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
    });
    const request: ModelRequest = {
      messages: [{ role: "user", content: "hi" }],
      promptCacheEnabled: true,
      tools: [
        { name: "Read", description: "Read file", inputSchema: { type: "object" } },
        { name: "Bash", description: "Run command", inputSchema: { type: "object" } },
      ],
    };

    const fiveMinute = provider.createAnthropicMessagesRequest(request);
    const oneHour = provider.createAnthropicMessagesRequest({ ...request, promptCacheTtl: "1h" });
    const stripOverlay = (tool: { cache_control?: unknown; [key: string]: unknown }) => {
      const { cache_control: _cacheControl, ...base } = tool;
      return base;
    };

    expect(JSON.stringify(fiveMinute.tools?.map(stripOverlay))).toBe(
      JSON.stringify(oneHour.tools?.map(stripOverlay)),
    );
    expect(fiveMinute.tools?.map((tool) => tool.cache_control)).not.toEqual(
      oneHour.tools?.map((tool) => tool.cache_control),
    );
  });

  it("D.13L: uses tool source and schema hash for the Anthropic cache boundary without sending metadata", () => {
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
      promptCacheEnabled: true,
      tools: [
        {
          name: "Read",
          description: "MCP override with built-in name",
          inputSchema: { type: "object", properties: { remote: { type: "boolean" } } },
          source: "mcp",
          schemaHash: "mcp-read-hash",
        },
        {
          name: "Read",
          description: "Built-in read",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
          source: "built-in",
          schemaHash: "builtin-read-hash",
        },
      ],
    });

    expect(body.tools?.map((tool) => tool.name)).toEqual(["Read", "Read", "web_search"]);
    expect(body.tools?.map((tool) => tool.cache_control)).toEqual([
      { type: "ephemeral" },
      undefined,
      undefined,
    ]);
    expect(JSON.stringify(body.tools)).not.toContain("schemaHash");
    expect(JSON.stringify(body.tools)).not.toContain("source");
    expect(body.tools?.[0].description).toBe("Built-in read");
    expect(body.tools?.[1].description).toBe("MCP override with built-in name");
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
            encoder.encode('data: {"id":"x","choices":[{"delta":{"content":"ok"}}]}\n\n'),
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

  it("HTTP 401 anthropic_messages: 错误对象暴露 endpointProfile/endpoint/状态码，不泄漏 apiKey 或 Bearer token", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key sk-test-secret Bearer test-secret"}}',
          { status: 401 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com",
      apiKey: "sk-test-secret",
      model: "claude-opus-4-7",
      endpointProfile: "anthropic_messages",
    });
    const collect = async () => {
      const events: LinghunEvent[] = [];
      for await (const event of provider.stream(
        { messages: [{ role: "user", content: "hi" }] },
        new AbortController().signal,
      )) {
        events.push(event);
      }
      return events;
    };

    await expect(collect()).rejects.toMatchObject({
      code: "PROVIDER_API_KEY_ERROR",
      message: expect.stringContaining("HTTP 401"),
    });
    await expect(collect()).rejects.toMatchObject({
      message: expect.stringContaining("anthropic_messages"),
    });
    await expect(collect()).rejects.toMatchObject({
      message: expect.stringContaining("/v1/messages"),
    });
    await expect(collect()).rejects.toMatchObject({
      suggestion: expect.stringContaining("x-api-key"),
    });
    await expect(collect()).rejects.not.toMatchObject({
      message: expect.stringMatching(/sk-test-secret|test-secret/),
    });
    await expect(collect()).rejects.not.toMatchObject({
      suggestion: expect.stringMatching(/sk-test-secret|test-secret/),
    });
  });

  it("HTTP 404 anthropic_messages: 暴露 endpoint 路径并提示 baseUrl 配置错位，不泄漏 apiKey", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          '{"type":"error","error":{"type":"not_found_error","message":"endpoint not found sk-test-secret"}}',
          { status: 404 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com",
      apiKey: "sk-test-secret",
      model: "claude-opus-4-7",
      endpointProfile: "anthropic_messages",
    });
    const collect = async () => {
      const events: LinghunEvent[] = [];
      for await (const event of provider.stream(
        { messages: [{ role: "user", content: "hi" }] },
        new AbortController().signal,
      )) {
        events.push(event);
      }
      return events;
    };

    await expect(collect()).rejects.toMatchObject({
      code: "PROVIDER_NOT_FOUND",
      message: expect.stringContaining("HTTP 404"),
    });
    await expect(collect()).rejects.toMatchObject({
      message: expect.stringContaining("anthropic_messages"),
    });
    await expect(collect()).rejects.toMatchObject({
      message: expect.stringContaining("/v1/messages"),
    });
    await expect(collect()).rejects.toMatchObject({
      suggestion: expect.stringContaining("base_url"),
    });
    await expect(collect()).rejects.not.toMatchObject({
      message: expect.stringMatching(/sk-test-secret/),
    });
  });

  it("HTTP 400 anthropic_messages: 暴露 invalid_request_error 摘要并指向 anthropic schema 字段，不泄漏 apiKey", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          '{"type":"error","error":{"type":"invalid_request_error","message":"invalid model claude-opus-4-7 sk-test-secret tool_choice unsupported"}}',
          { status: 400 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com",
      apiKey: "sk-test-secret",
      model: "claude-opus-4-7",
      endpointProfile: "anthropic_messages",
    });
    const collect = async () => {
      const events: LinghunEvent[] = [];
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
      message: expect.stringContaining("HTTP 400"),
    });
    await expect(collect()).rejects.toMatchObject({
      message: expect.stringContaining("anthropic_messages"),
    });
    await expect(collect()).rejects.toMatchObject({
      message: expect.stringContaining("invalid_request_error"),
    });
    await expect(collect()).rejects.toMatchObject({
      suggestion: expect.stringContaining("anthropic"),
    });
    await expect(collect()).rejects.not.toMatchObject({
      message: expect.stringMatching(/sk-test-secret/),
    });
  });

  it("malformed stream anthropic_messages: 不是 SSE/Anthropic 协议时给出诊断，不泄漏 apiKey", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // 网关返回 SSE 包裹但 payload 不是合法 Anthropic JSON：模拟网关
          // 把非 Anthropic message events（含 apiKey 的脏数据）回灌成事件流。
          controller.enqueue(
            encoder.encode("event: message_start\ndata: {not-json sk-test-secret leak}\n\n"),
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
      baseUrl: "https://relay.example.com",
      apiKey: "sk-test-secret",
      model: "claude-opus-4-7",
      endpointProfile: "anthropic_messages",
    });
    const events: LinghunEvent[] = [];
    for await (const event of provider.stream(
      { messages: [{ role: "user", content: "hi" }] },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    const errorEvent = events.find((event) => event.type === "error");
    expect(errorEvent).toBeDefined();
    if (!errorEvent || errorEvent.type !== "error") {
      throw new Error("expected error event");
    }
    const error = errorEvent.error as LinghunError;
    expect(["PROVIDER_MALFORMED_STREAM", "PROVIDER_STREAM_ERROR"]).toContain(error.code);
    expect(error.suggestion ?? "").toMatch(/Anthropic|messages|\/v1\/messages/);
    expect(error.message).not.toMatch(/sk-test-secret/);
    expect(error.suggestion ?? "").not.toMatch(/sk-test-secret/);
  });

  it("Fix C: anthropic_messages 200 + content-type=text/html → PROVIDER_NON_SSE_STREAM with content-type and endpoint, no apiKey leak", async () => {
    // 复现某些 OpenAI-compatible 网关在 /v1/messages 返回 200 + SPA HTML 的真实场景：
    // response.ok=true 但 content-type 不是 SSE，必须立即抛 PROVIDER_NON_SSE_STREAM，
    // 不能让 parser silent 出 message_stop 把 TUI 弄成"连不上"。
    const fetchMock = vi.fn(async () => {
      return new Response(
        "<!doctype html><html><head><title>Provider Login</title></head><body>Bearer provider-token-should-be-redacted</body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com",
      apiKey: "sk-test-secret",
      model: "claude-opus-4-7",
      endpointProfile: "anthropic_messages",
    });
    let caught: unknown;
    try {
      for await (const _event of provider.stream(
        { messages: [{ role: "user", content: "hi" }] },
        new AbortController().signal,
      )) {
        // drain
      }
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LinghunError);
    const error = caught as LinghunError;
    expect(error.code).toBe("PROVIDER_NON_SSE_STREAM");
    expect(error.message).toContain("text/html");
    expect(error.message).toContain("/v1/messages");
    expect(error.message).toContain("anthropic_messages");
    expect(error.message).not.toMatch(/sk-test-secret/);
    expect(error.message).not.toMatch(/provider-token-should-be-redacted/);
    expect(error.suggestion ?? "").not.toMatch(/sk-test-secret/);
  });

  it("Fix C: chat_completions 200 + content-type=text/html → PROVIDER_NON_SSE_STREAM with content-type and endpoint", async () => {
    // 反向回归：chat/responses 分支也要有相同 non-SSE 防御，避免 parseOpenAiStream
    // 在 HTML 响应里找不到 data: 行 silent 收尾。
    const fetchMock = vi.fn(async () => {
      return new Response(
        "<!doctype html><html><body>Authorization: Bearer provider-token-should-be-redacted</body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-4o-mini",
      endpointProfile: "chat_completions",
    });
    let caught: unknown;
    try {
      for await (const _event of provider.stream(
        { messages: [{ role: "user", content: "hi" }] },
        new AbortController().signal,
      )) {
        // drain
      }
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LinghunError);
    const error = caught as LinghunError;
    expect(error.code).toBe("PROVIDER_NON_SSE_STREAM");
    expect(error.message).toContain("text/html");
    expect(error.message).toContain("/chat/completions");
    expect(error.message).toContain("chat_completions");
    expect(error.message).not.toMatch(/sk-test-secret/);
    expect(error.message).not.toMatch(/provider-token-should-be-redacted/);
    expect(error.suggestion).toContain("root baseUrl + responses 可能可用");
    expect(error.suggestion).toContain("chat_completions 通常需要 /v1 root");
    expect(error.suggestion).toContain("text/html");
    expect(error.suggestion).toContain("少了 /v1");
  });

  it("Fix C: 200 + content-type=application/json (non-SSE) also rejected so partial JSON gateways do not silent-fail", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('{"error":"not streaming"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com",
      apiKey: "sk-test-secret",
      model: "claude-opus-4-7",
      endpointProfile: "anthropic_messages",
    });
    let caught: unknown;
    try {
      for await (const _event of provider.stream(
        { messages: [{ role: "user", content: "hi" }] },
        new AbortController().signal,
      )) {
        // drain
      }
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LinghunError);
    const error = caught as LinghunError;
    expect(error.code).toBe("PROVIDER_NON_SSE_STREAM");
    expect(error.message).toContain("application/json");
  });

  it("Fix C: 200 + content-type=text/event-stream;charset=utf-8 still passes through to parser", async () => {
    // 防御不能误伤合法 SSE：带 charset 后缀仍应放行，让 parser 正常吐事件。
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_pass"}}\n\n',
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
        headers: { "content-type": "text/event-stream; charset=utf-8" },
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
    // 至少能成功结束、不应抛 NON_SSE。
    expect(events.some((event) => event.type === "error")).toBe(false);
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
    expect(blocks[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]?.cache_control).toBeUndefined();
    // 5m 默认禁止 ttl 字面量
    expect(JSON.stringify(blocks[0])).not.toContain('"ttl"');
    expect(JSON.stringify(blocks[0])).not.toContain('"5m"');
  });

  it('sets ttl: "1h" only when promptCacheTtl is explicitly 1h', () => {
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

  it("attaches a message breakpoint to the current single-turn user request", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "alpha" },
        { role: "user", content: "current dynamic request" },
      ],
      promptCacheEnabled: true,
    });
    const userBlocks = body.messages.at(-1)?.content as Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: string };
    }>;
    expect(userBlocks[0]).toEqual({
      type: "text",
      text: "current dynamic request",
      cache_control: { type: "ephemeral" },
    });
  });

  it("attaches a message breakpoint to the latest user message", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "alpha" },
        { role: "user", content: "stable user prefix" },
        { role: "assistant", content: "ack" },
        { role: "user", content: "current dynamic request" },
      ],
      promptCacheEnabled: true,
    });
    const stableUserBlocks = body.messages[0]?.content as Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: string };
    }>;
    const currentUserBlocks = body.messages.at(-1)?.content as Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: string };
    }>;
    expect(stableUserBlocks[0]).toEqual({
      type: "text",
      text: "stable user prefix",
    });
    expect(currentUserBlocks[0]).toEqual({
      type: "text",
      text: "current dynamic request",
      cache_control: { type: "ephemeral" },
    });
  });

  it("advances Anthropic message cache_control past compact summaries to the latest user", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "alpha" },
        { role: "user", content: "Deep compact context\nsummary stable older context" },
        { role: "user", content: "Context compact projection\nsummary stable recent context" },
        { role: "user", content: "Post-compact restored context\nfrozen restore snapshot" },
        { role: "user", content: "rolling recent window" },
        { role: "assistant", content: "ack" },
        { role: "user", content: "current dynamic request" },
      ],
      promptCacheEnabled: true,
    });
    const deepBlocks = body.messages[0]?.content as Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: string };
    }>;
    const projectionBlocks = body.messages[1]?.content as Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: string };
    }>;
    const currentUserBlocks = body.messages.at(-1)?.content as Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: string };
    }>;

    expect(deepBlocks[0]?.cache_control).toBeUndefined();
    expect(projectionBlocks[0]).toEqual({
      type: "text",
      text: "Context compact projection\nsummary stable recent context",
    });
    expect(currentUserBlocks[0]).toEqual({
      type: "text",
      text: "current dynamic request",
      cache_control: { type: "ephemeral" },
    });
  });

  it("advances one Anthropic message marker through compact restore and a tool round", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "stable core" },
        { role: "system", content: "stable runtime" },
        { role: "user", content: "Deep compact context\nolder summary" },
        { role: "user", content: "Context compact projection\nrecent summary" },
        { role: "user", content: "Post-compact restored context\nfrozen restore" },
        {
          role: "assistant",
          content: "checking",
          toolCalls: [{ id: "call-1", name: "Read", input: { path: "README.md" } }],
        },
        { role: "tool", tool_call_id: "call-1", content: '{"ok":true}' },
      ],
      promptCacheEnabled: true,
    });
    const serialized = JSON.stringify(body.messages);
    const markerCount = serialized.match(/cache_control/g)?.length ?? 0;
    const finalBlocks = body.messages.at(-1)?.content as Array<{
      type: string;
      cache_control?: { type: "ephemeral" };
    }>;

    expect(markerCount).toBe(1);
    expect(finalBlocks.at(-1)).toMatchObject({
      type: "tool_result",
      cache_control: { type: "ephemeral" },
    });
  });

  it("marks the synthesized tool_result after an unpaired final assistant tool_use", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "user", content: "inspect" },
        {
          role: "assistant",
          content: "reading",
          toolCalls: [{ id: "call-1", name: "Read", input: { path: "README.md" } }],
        },
      ],
      promptCacheEnabled: true,
    });
    const assistantBlocks = body.messages[1]?.content as Array<{
      type: string;
      cache_control?: { type: "ephemeral" };
    }>;
    const repairBlocks = body.messages.at(-1)?.content as Array<{
      type: string;
      cache_control?: { type: "ephemeral" };
    }>;

    expect(assistantBlocks.at(-1)).toMatchObject({ type: "tool_use" });
    expect(assistantBlocks.at(-1)?.cache_control).toBeUndefined();
    expect(repairBlocks.at(-1)).toMatchObject({
      type: "tool_result",
      cache_control: { type: "ephemeral" },
    });
  });

  it("marks the final assistant text block when it is the last provider message", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "final answer" },
      ],
      promptCacheEnabled: true,
    });
    const assistantBlocks = body.messages.at(-1)?.content as Array<{
      type: string;
      text: string;
      cache_control?: { type: "ephemeral" };
    }>;

    expect(assistantBlocks.at(-1)).toEqual({
      type: "text",
      text: "final answer",
      cache_control: { type: "ephemeral" },
    });
  });

  it("uses the last explicit cacheable system segment as the Anthropic cache boundary", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "core stable", promptCache: "cacheable" },
        { role: "system", content: "low churn memory", promptCache: "cacheable" },
        { role: "system", content: "volatile runtime", promptCache: "volatile" },
        { role: "user", content: "hi" },
      ],
      promptCacheEnabled: true,
      cacheBreakNonce: "nonce-explicit-1",
    });
    const blocks = body.system as Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: string };
    }>;
    expect(blocks.map((block) => block.cache_control)).toEqual([
      undefined,
      { type: "ephemeral" },
      undefined,
    ]);
    expect(blocks[1]?.text).toContain("low churn memory");
    expect(blocks[1]?.text).toContain("<!-- linghun-break-cache:nonce-explicit-1 -->");
    expect(blocks[2]?.text).toBe("volatile runtime");
  });

  it("does not attach system cache_control when explicit hints mark all system segments volatile", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "volatile runtime", promptCache: "volatile" },
        { role: "user", content: "hi" },
      ],
      promptCacheEnabled: true,
    });
    const blocks = body.system as Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: string };
    }>;
    expect(blocks[0]?.cache_control).toBeUndefined();
    expect(blocks[0]?.text).toBe("volatile runtime");
  });

  it("does not append cacheBreakNonce to the current user message", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "stable user prefix" }],
      promptCacheEnabled: true,
      cacheBreakNonce: "nonce-user-1",
    });
    expect(body.system).toBeUndefined();
    const userBlocks = body.messages[0]?.content as Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: string };
    }>;
    expect(userBlocks[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(userBlocks[0]?.text).not.toContain("linghun-break-cache");
  });

  it("appends linghun-break-cache nonce to the system cache boundary when cacheBreakNonce provided", () => {
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
    expect(blocks[0]?.text).toContain("alpha");
    expect(blocks[0]?.text).toContain("<!-- linghun-break-cache:nonce-xyz-123 -->");
    expect(blocks[1]?.text).toBe("beta");
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
    expect(body.messages[0]?.content).toBe("hi");
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
    expect(usage?.usage.cacheWriteTokens).toBe(127);
  });

  it("prefers provider-reported cache_creation_input_tokens over split ephemeral totals", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_2b","usage":{"input_tokens":10}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4,"cache_creation_input_tokens":300,"cache_creation":{"ephemeral_5m_input_tokens":120,"ephemeral_1h_input_tokens":7}}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const usage = events.find(
      (event): event is Extract<LinghunEvent, { type: "usage" }> => event.type === "usage",
    );
    expect(usage?.usage.cacheWriteTokens).toBe(300);
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
    const names = request.tools?.flatMap((tool) =>
      tool.type === "function" ? [tool.function.name] : [],
    );
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
    const names = request.tools
      ?.filter((tool) => tool.type === "function")
      .map((tool) => tool.name);
    expect(names).toEqual(["Alpha", "Mike", "Zeta"]);
    expect(request.tools?.at(-1)).toEqual({ type: "web_search", external_web_access: true });
  });

  it("keeps OpenAI chat/responses bodies free of Anthropic-only cache fields", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-x",
    });
    const request: ModelRequest = {
      messages: [
        { role: "system", content: "stable system", promptCache: "cacheable" },
        { role: "system", content: "dynamic system", promptCache: "volatile" },
        { role: "user", content: "hi", promptCache: "cacheable" },
      ],
      promptCacheEnabled: true,
      promptCacheTtl: "1h",
      cacheBreakNonce: "nonce-abc",
      tools: [{ name: "Read", description: "Read file", inputSchema: { type: "object" } }],
      toolChoice: "auto",
    };
    const chat = provider.createChatRequest(request);
    const responses = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-x",
      endpointProfile: "responses",
    }).createResponsesRequest(request);

    expect(chat.tools?.[0]).toMatchObject({
      type: "function",
      function: { name: "Read", parameters: { type: "object" } },
    });
    expect(responses.tools?.[0]).toMatchObject({
      type: "function",
      name: "Read",
      parameters: { type: "object" },
    });
    expect(JSON.stringify(chat)).not.toContain("prompt_cache_key");
    expect(JSON.stringify(responses)).not.toContain("prompt_cache_key");
    for (const body of [chat, responses] as unknown[]) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("prompt_cache_retention");
      expect(serialized).not.toContain("cache_control");
      expect(serialized).not.toContain("linghun-break-cache");
      expect(serialized).not.toContain("promptCache");
      expect(serialized).not.toContain("cacheable");
      expect(serialized).not.toContain("volatile");
      expect(serialized).not.toContain("input_schema");
    }
  });

  it("sends prompt_cache_key only on OpenAI Responses when explicitly provided", () => {
    const request: ModelRequest = {
      messages: [{ role: "user", content: "hi" }],
      promptCacheEnabled: true,
      promptCacheKey: "linghun:test-cache-key",
    };
    const chat = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-x",
    }).createChatRequest(request);
    const responses = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-x",
      endpointProfile: "responses",
    }).createResponsesRequest(request);

    expect(JSON.stringify(chat)).not.toContain("prompt_cache_key");
    expect(responses.prompt_cache_key).toBe("linghun:test-cache-key");
  });
});

describe("D.13F end-to-end Anthropic POST body with cache_control", () => {
  it("sends cache_control on the system cache boundary over the wire", async () => {
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
        { role: "system", content: "You are Linghun.", promptCache: "cacheable" },
        { role: "system", content: "Dynamic turn context.", promptCache: "volatile" },
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
    expect(sent.system[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(sent.system[0]?.text).toContain("<!-- linghun-break-cache:wire-nonce-9 -->");
    expect(sent.system[1]?.cache_control).toBeUndefined();
    expect(sent.system[1]?.text).toBe("Dynamic turn context.");
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

  it("Run 3 closure: pure text request with supportsTools=false omits tools/tool_choice", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
      supportsTools: false,
    });
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("Run 3 closure: toolChoice-only request still fails when supportsTools=false", () => {
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
        toolChoice: "none",
      }),
    ).toThrow(expect.objectContaining({ code: "MODEL_TOOLS_UNSUPPORTED" }));
  });

  it("builder: assistant.toolCalls converts to user|assistant tool_use blocks; tool role converts to user tool_result block", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "user", content: "list README" },
        {
          role: "assistant",
          content: "let me read it",
          toolCalls: [{ id: "call-1", name: "Read", input: { path: "README.md" } }],
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
    const assistantBlocks = assistantTurn.content as Array<{
      type: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
    expect(assistantBlocks).toEqual([
      { type: "text", text: "let me read it" },
      { type: "tool_use", id: "call-1", name: "Read", input: { path: "README.md" } },
    ]);
    // tool 消息：必须折叠到下一个 user 消息的 tool_result block
    const toolResultTurn = body.messages[2];
    expect(toolResultTurn.role).toBe("user");
    const userBlocks = toolResultTurn.content as Array<{
      type: string;
      tool_use_id?: string;
      content?: string;
    }>;
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
    const blocks = last?.content as Array<{
      type: string;
      tool_use_id?: string;
      is_error?: boolean;
      content?: string;
    }>;
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
    expect(systemBlocks[0]?.cache_control).toEqual({ type: "ephemeral" });
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

  it("stream parser: accepts Anthropic SSE frames with CR-only line endings", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\rdata: {"type":"message_start","message":{"id":"msg_cr","usage":{"input_tokens":1}}}\r\r',
      'event: content_block_delta\rdata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\r\r',
      'event: message_stop\rdata: {"type":"message_stop"}\r\r',
    ]);

    expect(events).toEqual([
      { type: "assistant_text_delta", id: "msg_cr", text: "ok" },
      {
        type: "message_stop",
        id: "msg_cr",
        finishReason: undefined,
        chunkCount: 3,
        hadUsage: false,
      },
    ]);
  });

  it("stream parser: emits recoverable error when Anthropic stream closes before message_stop", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_early"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n',
    ]);

    expect(events).toEqual([
      { type: "assistant_text_delta", id: "msg_early", text: "partial" },
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "PROVIDER_STREAM_ERROR", recoverable: true }),
      }),
    ]);
  });

  it("stream parser: unfinished Anthropic tool_use emits PROVIDER_PARTIAL_TOOL_CALL", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_partial"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-open","name":"Read"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const error = events.find(
      (event): event is Extract<LinghunEvent, { type: "error" }> => event.type === "error",
    );

    expect(error?.error.code).toBe("PROVIDER_PARTIAL_TOOL_CALL");
    expect(events.at(-1)?.type).toBe("message_stop");
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
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
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
    // D.13F：system cache 边界仍挂 cache_control: { type: "ephemeral" }。
    expect(Array.isArray(body.system)).toBe(true);
    const systemBlocks = body.system as Array<{
      type: string;
      text: string;
      cache_control?: { type: string; ttl?: string };
    }>;
    expect(systemBlocks[0]?.cache_control).toEqual({ type: "ephemeral" });
    // body 不能包含 cache_edits / cache_reference。
    const bodyText = init.body as string;
    expect(bodyText).not.toContain("cache_edits");
    expect(bodyText).not.toContain("cache_reference");
  });
});

// ---------------------------------------------------------------------------
// D.13K — Anthropic Messages extended thinking (推理强度真正生效)
// reasoningLevel=Low/Medium/High 时，body 必须带原生 Anthropic `thinking` 字段；
// OpenAI strict chat / responses 原有 reasoning 行为不回归；
// strict chat 永远不出现 Anthropic `thinking` 字段。
// ---------------------------------------------------------------------------
describe("D.13K Anthropic Messages extended thinking", () => {
  function buildClaudeProvider(
    overrides: Partial<
      Parameters<typeof OpenAiCompatibleProvider.prototype.createAnthropicMessagesRequest>[0]
    > = {},
  ) {
    return new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-opus-4-7",
      endpointProfile: "anthropic_messages",
      ...overrides,
    });
  }

  it("contract: anthropic_messages + reasoningLevel=High → sendReasoning=true", () => {
    const contract = resolveProviderRuntimeContract({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-opus-4-7",
      endpointProfile: "anthropic_messages",
      reasoningLevel: "High",
    });
    expect(contract.endpointProfile).toBe("anthropic_messages");
    expect(contract.sendReasoning).toBe(true);
  });

  it("contract: anthropic_messages 无 reasoningLevel → sendReasoning=false", () => {
    const contract = resolveProviderRuntimeContract({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-opus-4-7",
      endpointProfile: "anthropic_messages",
    });
    expect(contract.sendReasoning).toBe(false);
  });

  it("body: reasoningLevel=High → thinking={type:'enabled', budget_tokens:8192}", () => {
    const provider = buildClaudeProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
      reasoningLevel: "High",
    });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
  });

  it("body: reasoningLevel=Medium → budget_tokens=4096", () => {
    const provider = buildClaudeProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
      reasoningLevel: "Medium",
    });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });

  it("body: reasoningLevel=Low → budget_tokens=1024", () => {
    const provider = buildClaudeProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
      reasoningLevel: "Low",
    });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
  });

  it("body: 大小写无关——'high' / 'HIGH' / 'High' 都映射到 8192", () => {
    const provider = buildClaudeProvider();
    for (const level of ["high", "HIGH", "High"]) {
      const body = provider.createAnthropicMessagesRequest({
        messages: [{ role: "user", content: "hi" }],
        reasoningLevel: level,
      });
      expect(body.thinking?.budget_tokens).toBe(8192);
    }
  });

  it("body: 无 reasoningLevel → 不写 thinking 字段", () => {
    const provider = buildClaudeProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.thinking).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("thinking");
  });

  it("body: config.reasoningLevel=High 也生效（request 不显式传时 fallback）", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-opus-4-7",
      endpointProfile: "anthropic_messages",
      reasoningLevel: "High",
    });
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
  });

  it("body: max_tokens 安全处理——thinking budget=8192 + max_tokens=1024 → 抬升到 9216", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-opus-4-7",
      endpointProfile: "anthropic_messages",
      maxOutputTokens: 1024,
    });
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
      reasoningLevel: "High",
    });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(body.max_tokens).toBeGreaterThanOrEqual(8192 + 1024);
  });

  it("strict chat profile: reasoningLevel=High 永远不出现 Anthropic thinking 字段，也不出现 OpenAI reasoning", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "custom-model",
      reasoningLevel: "Medium",
    });
    const request = provider.createChatRequest({
      messages: [{ role: "user", content: "hi" }],
      reasoningLevel: "High",
    });
    expect(JSON.stringify(request)).not.toContain("thinking");
    expect(request).not.toHaveProperty("reasoning");
  });

  it("OpenAI Responses profile: reasoning.effort uses lowercase API values and does not send Anthropic thinking", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-5.5",
      endpointProfile: "responses",
      reasoningLevel: "High",
    });
    const request = provider.createResponsesRequest({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(request.reasoning).toEqual({ effort: "high" });
    expect(JSON.stringify(request)).not.toContain("thinking");
  });

  it("wire(stream): anthropic_messages reasoningLevel=High → POST body 含 thinking 字段，URL=/v1/messages", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_k"}}\n\n',
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
    const provider = buildClaudeProvider();
    for await (const _ of provider.stream(
      {
        messages: [{ role: "user", content: "hi" }],
        reasoningLevel: "High",
      },
      new AbortController().signal,
    )) {
      // drain
    }
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(url).toBe("https://relay.example.com/v1/messages");
    const sent = JSON.parse(String(init.body)) as {
      thinking?: { type: string; budget_tokens: number };
    };
    expect(sent.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
  });
});

// ---------------------------------------------------------------------------
// D.13M — Anthropic Messages extended thinking SSE (thinking_delta / signature_delta / redacted_thinking)
// ---------------------------------------------------------------------------
describe("D.13M Anthropic Messages extended thinking SSE", () => {
  it("content_block_delta thinking_delta → emits assistant_thinking_delta with thinking text", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-think-1","usage":{"input_tokens":10}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"分析"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"中"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-fragment"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const thinking = events.filter(
      (event): event is Extract<LinghunEvent, { type: "assistant_thinking_delta" }> =>
        event.type === "assistant_thinking_delta",
    );
    expect(thinking).toEqual([
      { type: "assistant_thinking_delta", id: "msg-think-1", text: "分析" },
      { type: "assistant_thinking_delta", id: "msg-think-1", text: "中" },
    ]);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.some((event) => event.type === "assistant_text_delta")).toBe(false);
  });

  it("thinking_delta followed by text_delta → emits thinking then text in order", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-think-2","usage":{"input_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"思考"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"abc"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"答案"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const types = events.map((event) => event.type);
    const thinkingIdx = types.indexOf("assistant_thinking_delta");
    const textIdx = types.indexOf("assistant_text_delta");
    expect(thinkingIdx).toBeGreaterThanOrEqual(0);
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(thinkingIdx).toBeLessThan(textIdx);
    const text = events.filter(
      (event): event is Extract<LinghunEvent, { type: "assistant_text_delta" }> =>
        event.type === "assistant_text_delta",
    );
    expect(text).toEqual([{ type: "assistant_text_delta", id: "msg-think-2", text: "答案" }]);
  });

  it("redacted_thinking content block + signature_delta → no leak, no error, marks thinking via empty assistant_thinking_delta", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-redact","usage":{"input_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"redacted_thinking","data":"REDACTED-PAYLOAD"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"redacted_thinking","data":"MORE-REDACTED"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    expect(events.some((event) => event.type === "error")).toBe(false);
    const thinking = events.filter(
      (event): event is Extract<LinghunEvent, { type: "assistant_thinking_delta" }> =>
        event.type === "assistant_thinking_delta",
    );
    expect(thinking.length).toBeGreaterThanOrEqual(1);
    for (const event of thinking) {
      expect(event.text).toBe("");
    }
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("REDACTED-PAYLOAD");
    expect(serialized).not.toContain("MORE-REDACTED");
  });

  it("thinking_delta followed by tool_use → emits thinking then tool_use; tool continuation not blocked", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-think-tool","usage":{"input_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"先思考"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"s"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-think-1","name":"Read"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"README.md\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const types = events.map((event) => event.type);
    const thinkingIdx = types.indexOf("assistant_thinking_delta");
    const toolIdx = types.indexOf("tool_use");
    expect(thinkingIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(thinkingIdx).toBeLessThan(toolIdx);
    const tool = events.filter(
      (event): event is Extract<LinghunEvent, { type: "tool_use" }> => event.type === "tool_use",
    );
    expect(tool).toEqual([
      { type: "tool_use", id: "call-think-1", name: "Read", input: { path: "README.md" } },
    ]);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });
});
