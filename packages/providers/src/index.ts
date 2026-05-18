import { LinghunError } from "@linghun/core";

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheWriteTokensRaw?: number | null;
  cacheWriteTokensEstimated?: boolean;
  rawUsage?: unknown;
  endpoint?: string;
};

export type ModelToolDefinition = {
  name: string;
  description: string;
  inputSchema: unknown;
};

export type LinghunEvent =
  | { type: "assistant_text_delta"; id: string; text: string }
  | { type: "assistant_thinking_delta"; id: string; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: unknown; isError?: boolean }
  | { type: "usage"; usage: ModelUsage }
  | {
      type: "message_stop";
      id: string;
      finishReason?: string;
      chunkCount: number;
      hadUsage: boolean;
    }
  | { type: "error"; error: LinghunError };

export type ModelInfo = {
  id: string;
  displayName: string;
  providerId: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsThinking: boolean;
  supportsPromptCache: boolean;
  inputPricePerMTok?: number;
  outputPricePerMTok?: number;
};

export type ProviderCapabilities = {
  streaming: boolean;
  usage: boolean;
};

export type ProviderConfig = {
  id: string;
  type: "openai-compatible" | "deepseek";
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  maxOutputTokens?: number;
  supportsTools?: boolean;
};

export type ModelToolCall = {
  id: string;
  name: string;
  input: unknown;
};

type PendingOpenAiToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ModelToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type ModelRequest = {
  messages: ModelMessage[];
  model?: string;
  maxOutputTokens?: number;
  tools?: ModelToolDefinition[];
  toolChoice?: "auto" | "none";
};

export type Provider = {
  id: string;
  displayName: string;
  supports: ProviderCapabilities;
  listModels(): Promise<ModelInfo[]>;
  stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<LinghunEvent>;
};

export type OpenAiChatRequest = {
  model: string;
  messages: OpenAiChatMessage[];
  stream: true;
  max_tokens: number;
  tools?: OpenAiToolDefinition[];
  tool_choice?: "auto" | "none";
};

type OpenAiChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

type OpenAiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
};

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export const deepSeekModels: ModelInfo[] = [
  {
    id: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    providerId: "deepseek",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    supportsPromptCache: false,
  },
  {
    id: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro 1M",
    providerId: "deepseek",
    contextWindow: 1_048_576,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    supportsPromptCache: false,
  },
];

export function findKnownModel(modelId: string): ModelInfo | undefined {
  return deepSeekModels.find((model) => model.id === modelId);
}

export class ModelGateway {
  constructor(private readonly providers: Provider[]) {}

  async currentModel(providerId: string, modelId: string): Promise<ModelInfo> {
    const provider = this.findProvider(providerId);
    const models = await provider.listModels();
    const model = models.find((item) => item.id === modelId);
    if (!model) {
      throw new LinghunError({
        code: "MODEL_NOT_FOUND",
        message: `未找到模型：${modelId}`,
        suggestion: "请运行 /model 查看当前可用模型。",
        recoverable: true,
      });
    }
    return model;
  }

  async *stream(
    providerId: string,
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LinghunEvent> {
    const provider = this.findProvider(providerId);
    try {
      const safeRequest = await this.withSupportedTools(provider, request);
      yield* provider.stream(safeRequest, signal);
    } catch (error) {
      const linghunError = normalizeProviderError(error);
      yield { type: "error", error: linghunError };
    }
  }

  private async withSupportedTools(
    provider: Provider,
    request: ModelRequest,
  ): Promise<ModelRequest> {
    if (!request.tools || request.tools.length === 0) {
      return request;
    }
    const model = request.model;
    if (!model) {
      return request;
    }
    const models = await provider.listModels();
    const info = models.find((item) => item.id === model);
    if (info?.supportsTools !== false) {
      return request;
    }
    const { tools: _tools, toolChoice: _toolChoice, ...rest } = request;
    return rest;
  }

  private findProvider(providerId: string): Provider {
    const provider = this.providers.find((item) => item.id === providerId);
    if (!provider) {
      throw new LinghunError({
        code: "PROVIDER_NOT_FOUND",
        message: `未找到模型供应商：${providerId}`,
        suggestion: "请运行 /model doctor 检查 provider 配置。",
        recoverable: true,
      });
    }
    return provider;
  }
}

export class OpenAiCompatibleProvider implements Provider {
  readonly id: string;
  readonly displayName: string;
  readonly supports = { streaming: true, usage: true } satisfies ProviderCapabilities;

  constructor(private readonly config: ProviderConfig) {
    this.id = config.id;
    this.displayName = config.displayName ?? "OpenAI compatible";
  }

  async listModels(): Promise<ModelInfo[]> {
    const known = findKnownModel(this.config.model);
    if (known) {
      return [{ ...known, providerId: this.id }];
    }
    return [
      {
        id: this.config.model,
        displayName: this.config.model,
        providerId: this.id,
        contextWindow: 128_000,
        maxOutputTokens: this.config.maxOutputTokens ?? 4_096,
        supportsTools: this.config.supportsTools ?? true,
        supportsVision: false,
        supportsThinking: false,
        supportsPromptCache: false,
      },
    ];
  }

  createChatRequest(request: ModelRequest): OpenAiChatRequest {
    const model = request.model ?? this.config.model;
    const known = findKnownModel(model);
    const maxAllowed = known?.maxOutputTokens ?? this.config.maxOutputTokens ?? 4_096;
    const requested = request.maxOutputTokens ?? this.config.maxOutputTokens ?? maxAllowed;
    const tools =
      this.config.supportsTools === false
        ? undefined
        : request.tools?.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          }));
    return {
      model,
      messages: request.messages.map(toOpenAiMessage),
      stream: true,
      max_tokens: Math.min(requested, maxAllowed),
      ...(tools && tools.length > 0 ? { tools, tool_choice: request.toolChoice ?? "auto" } : {}),
    };
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<LinghunEvent> {
    this.assertReady();
    const body = this.createChatRequest(request);
    const response = await fetch(`${this.normalizedBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw createApiKeyError(response.status);
      }
      throw createHttpStatusError(response.status);
    }

    if (!response.body) {
      throw new LinghunError({
        code: "PROVIDER_STREAM_EMPTY",
        message: "模型请求失败：响应中没有可读取的流。",
        suggestion: "请确认 base_url 是 OpenAI compatible 的 chat completions 接口。",
        recoverable: true,
      });
    }

    yield* parseOpenAiStream(response.body);
  }

  private assertReady(): void {
    if (!this.config.baseUrl) {
      throw new LinghunError({
        code: "MODEL_BASE_URL_MISSING",
        message: "模型配置缺少 base_url。",
        suggestion: "请为当前 provider 设置 base_url，例如 https://api.deepseek.com/v1。",
        recoverable: true,
      });
    }
    if (!this.config.apiKey) {
      throw new LinghunError({
        code: "MODEL_API_KEY_MISSING",
        message: "模型配置缺少 api_key。",
        suggestion: "请设置环境变量或本地配置中的 api_key，然后运行 /model doctor 复查。",
        recoverable: true,
      });
    }
  }

  private normalizedBaseUrl(): string {
    return this.config.baseUrl?.replace(/\/+$/, "") ?? "";
  }
}

function toOpenAiMessage(message: ModelMessage): OpenAiChatMessage {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content || null,
      ...(message.toolCalls && message.toolCalls.length > 0
        ? {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function" as const,
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.input ?? {}),
              },
            })),
          }
        : {}),
    };
  }
  if (message.role === "tool") {
    return message;
  }
  return message;
}

export async function* parseOpenAiStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<LinghunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state: OpenAiStreamParseState = {
    pendingToolCalls: new Map(),
    chunkCount: 0,
    finishReason: undefined,
    hadUsage: false,
    lastId: "assistant",
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      for (const event of parseOpenAiStreamLine(line, state)) {
        yield event;
      }
    }
  }

  const tail = decoder.decode();
  if (tail) {
    buffer += tail;
  }
  for (const event of parseOpenAiStreamLine(buffer, state)) {
    yield event;
  }
  yield {
    type: "message_stop",
    id: state.lastId,
    finishReason: state.finishReason,
    chunkCount: state.chunkCount,
    hadUsage: state.hadUsage,
  };
}

type OpenAiStreamParseState = {
  pendingToolCalls: Map<number, PendingOpenAiToolCall>;
  chunkCount: number;
  finishReason?: string;
  hadUsage: boolean;
  lastId: string;
};

type OpenAiStreamChoice = {
  delta?: {
    content?: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
    tool_calls?: OpenAiStreamToolCall[];
  };
  message?: {
    content?: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
    tool_calls?: OpenAiStreamToolCall[];
  };
  finish_reason?: string | null;
};

type OpenAiStreamToolCall = {
  id?: string;
  index?: number;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAiStreamUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_creation_tokens?: number;
  };
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation_tokens?: number;
};

function parseOpenAiStreamLine(line: string, state: OpenAiStreamParseState): LinghunEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return [];
  }
  const payload = trimmed.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") {
    return [];
  }
  state.chunkCount += 1;

  let parsed: {
    id?: string;
    choices?: OpenAiStreamChoice[];
    usage?: OpenAiStreamUsage;
    error?: { message?: string; type?: string; code?: string } | string;
  };
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    return [
      {
        type: "error",
        error: new LinghunError({
          code: "PROVIDER_MALFORMED_STREAM",
          message: "模型请求失败：provider 返回了无法解析的流式 JSON。",
          suggestion:
            "请运行 /model doctor 检查 base_url 是否为 OpenAI compatible 接口，或切换 provider/model 后重试。",
          cause: error,
          recoverable: true,
        }),
      },
    ];
  }

  if (parsed.id) {
    state.lastId = parsed.id;
  }
  if (parsed.error) {
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error.message;
    return [
      {
        type: "error",
        error: new LinghunError({
          code: "PROVIDER_STREAM_ERROR",
          message: `模型请求失败：provider 流式返回错误${message ? `：${message}` : "。"}`,
          suggestion:
            "请运行 /model doctor 检查 provider/model、额度、base_url 和 tool calling 兼容性。",
          recoverable: true,
        }),
      },
    ];
  }

  const events: LinghunEvent[] = [];
  for (const choice of parsed.choices ?? []) {
    if (choice.finish_reason) {
      state.finishReason = choice.finish_reason;
    }
    const content = choice.delta?.content ?? choice.message?.content;
    if (content) {
      events.push({ type: "assistant_text_delta", id: parsed.id ?? "assistant", text: content });
    }
    const reasoning =
      choice.delta?.reasoning_content ??
      choice.delta?.reasoning ??
      choice.message?.reasoning_content ??
      choice.message?.reasoning;
    if (reasoning) {
      events.push({
        type: "assistant_thinking_delta",
        id: parsed.id ?? "assistant",
        text: reasoning,
      });
    }
    events.push(
      ...parseOpenAiToolCalls(choice.delta?.tool_calls ?? choice.message?.tool_calls ?? [], state),
    );
  }
  if (parsed.usage) {
    state.hadUsage = true;
    const cacheWriteTokensRaw = readCacheWriteTokens(parsed.usage);
    events.push({
      type: "usage",
      usage: {
        inputTokens: parsed.usage.prompt_tokens ?? 0,
        outputTokens: parsed.usage.completion_tokens ?? 0,
        totalTokens: parsed.usage.total_tokens ?? 0,
        cacheReadTokens:
          parsed.usage.prompt_tokens_details?.cached_tokens ?? parsed.usage.cache_read_input_tokens,
        cacheWriteTokens: cacheWriteTokensRaw ?? undefined,
        cacheWriteTokensRaw,
        rawUsage: parsed.usage,
        endpoint: "/v1/chat/completions",
      },
    });
  }
  return events;
}

function parseOpenAiToolCalls(
  toolCalls: OpenAiStreamToolCall[],
  state: OpenAiStreamParseState,
): LinghunEvent[] {
  const events: LinghunEvent[] = [];
  for (const [fallbackIndex, toolCall] of toolCalls.entries()) {
    const index = toolCall.index ?? fallbackIndex;
    const existing = state.pendingToolCalls.get(index) ?? {
      id: `tool-${index + 1}`,
      name: "",
      arguments: "",
    };
    const next = {
      id: toolCall.id ?? existing.id,
      name: toolCall.function?.name ?? existing.name,
      arguments: existing.arguments + (toolCall.function?.arguments ?? ""),
    };
    state.pendingToolCalls.set(index, next);
    if (!next.name || !isCompleteJsonObject(next.arguments)) {
      continue;
    }
    events.push({
      type: "tool_use",
      id: next.id,
      name: next.name,
      input: parseToolArguments(next.arguments),
    });
    state.pendingToolCalls.delete(index);
  }
  return events;
}

function parseToolArguments(value: string): unknown {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return { raw: value };
  }
}

function isCompleteJsonObject(value: string): boolean {
  if (!value.trim()) {
    return false;
  }
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function readCacheWriteTokens(usage: {
  prompt_tokens_details?: { cache_creation_tokens?: number };
  cache_creation_input_tokens?: number;
  cache_creation_tokens?: number;
}): number | null {
  if (typeof usage.prompt_tokens_details?.cache_creation_tokens === "number") {
    return usage.prompt_tokens_details.cache_creation_tokens;
  }
  if (typeof usage.cache_creation_input_tokens === "number") {
    return usage.cache_creation_input_tokens;
  }
  if (typeof usage.cache_creation_tokens === "number") {
    return usage.cache_creation_tokens;
  }
  return null;
}

export class DeepSeekProvider extends OpenAiCompatibleProvider {
  constructor(config: Omit<ProviderConfig, "type" | "id"> & Partial<Pick<ProviderConfig, "id">>) {
    super({
      ...config,
      id: config.id ?? "deepseek",
      type: "deepseek",
      displayName: config.displayName ?? "DeepSeek",
      baseUrl: config.baseUrl ?? "https://api.deepseek.com/v1",
    });
  }
}

export function normalizeProviderError(error: unknown): LinghunError {
  if (error instanceof LinghunError) {
    return error;
  }
  const status = readStatus(error);
  if (status === 401 || status === 403) {
    return createApiKeyError(status, error);
  }
  if (typeof status === "number") {
    return createHttpStatusError(status);
  }
  if (error instanceof TypeError) {
    return new LinghunError({
      code: "PROVIDER_NETWORK_ERROR",
      message: "模型请求失败：无法连接到模型服务。",
      suggestion: "请检查网络、base_url 是否正确，或稍后重试。",
      cause: error,
      recoverable: true,
    });
  }
  if (error instanceof Error) {
    return new LinghunError({
      code: "PROVIDER_ERROR",
      message: `模型请求失败：${error.message}`,
      suggestion: "请运行 /model doctor 检查当前 provider 配置。",
      cause: error,
      recoverable: true,
    });
  }
  return new LinghunError({
    code: "PROVIDER_UNKNOWN_ERROR",
    message: "模型请求失败：未知错误。",
    suggestion: "请运行 /model doctor 检查当前 provider 配置。",
    cause: error,
    recoverable: true,
  });
}

function createApiKeyError(status: number, cause?: unknown): LinghunError {
  return new LinghunError({
    code: "PROVIDER_API_KEY_ERROR",
    message: `模型请求失败：API Key 无效或没有权限（HTTP ${status}）。`,
    suggestion: "请检查当前 provider 的 api_key 是否正确，或运行 /model doctor 复查配置。",
    cause,
    recoverable: true,
  });
}

function createHttpStatusError(status: number): LinghunError {
  if (status === 400) {
    return new LinghunError({
      code: "PROVIDER_BAD_REQUEST",
      message: "模型请求失败：HTTP 400，请求格式不被 provider 接受。",
      suggestion:
        "请运行 /model doctor；重点检查 base_url、model、tools/tool_choice 支持、tool_result 回灌格式和 OpenAI-compatible 网关兼容性。",
      recoverable: true,
    });
  }
  if (status === 429) {
    return new LinghunError({
      code: "PROVIDER_RATE_LIMITED",
      message: "模型请求失败：HTTP 429，已触发 provider 限流或额度限制。",
      suggestion: "请稍后重试，或运行 /usage 与 /model doctor 检查当前 provider/model 配置。",
      recoverable: true,
    });
  }
  if (status >= 500) {
    return new LinghunError({
      code: "PROVIDER_SERVER_ERROR",
      message: `模型请求失败：HTTP ${status}，provider 服务端异常。`,
      suggestion:
        "请稍后重试；如持续失败，运行 /model doctor 检查 base_url 或切换 fallback model。",
      recoverable: true,
    });
  }
  return new LinghunError({
    code: "PROVIDER_HTTP_ERROR",
    message: `模型请求失败：HTTP ${status}。`,
    suggestion: "请运行 /model doctor 检查 API Key、base_url、model 和 provider 能力。",
    recoverable: status >= 400 && status < 500,
  });
}

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const candidate = error as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === "number") {
    return candidate.status;
  }
  if (typeof candidate.statusCode === "number") {
    return candidate.statusCode;
  }
  return undefined;
}
