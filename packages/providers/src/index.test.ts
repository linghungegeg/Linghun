import { LinghunError } from "@linghun/core";
import { describe, expect, it } from "vitest";
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

  it("uses the DeepSeek default base URL", async () => {
    const provider = new DeepSeekProvider({ model: "deepseek-v4-pro" });
    const models = await provider.listModels();

    expect(models[0]?.id).toBe("deepseek-v4-pro");
    expect(models[0]?.contextWindow).toBe(1_048_576);
  });
});

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
    ]);
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
});
