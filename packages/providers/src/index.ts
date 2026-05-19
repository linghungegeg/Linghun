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

export type EndpointProfile = "chat_completions" | "responses";
export type ProviderRuntimeProfile =
  | "deepseek_chat_completions"
  | "openai_compatible_chat_completions"
  | "openai_responses";

export type ProviderConfig = {
  id: string;
  type: "openai-compatible" | "deepseek";
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  endpointProfile?: EndpointProfile;
  reasoningLevel?: string;
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
  endpointProfile?: EndpointProfile;
  reasoningLevel?: string;
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
  reasoning?: { effort: string };
};

export type OpenAiResponsesRequest = {
  model: string;
  input: OpenAiResponsesInputItem[];
  stream: true;
  max_output_tokens: number;
  tools?: OpenAiResponsesToolDefinition[];
  tool_choice?: "auto" | "none";
  reasoning?: { effort: string };
};

type OpenAiChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

type OpenAiResponsesInputItem =
  | { role: "system" | "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

type OpenAiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
};

type OpenAiResponsesToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: unknown;
};

type PendingResponsesToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type ProviderRuntimeContract = {
  profile: ProviderRuntimeProfile;
  endpointProfile: EndpointProfile;
  endpoint: "/chat/completions" | "/responses";
  toolResultShape: "chat_tool_message" | "responses_function_call_output";
};

const PROVIDER_RETRY_STATUSES = new Set([429, 502, 503, 504]);
const PROVIDER_MAX_ATTEMPTS = 3;
const PROVIDER_BASE_RETRY_MS = 500;
const PROVIDER_STREAM_IDLE_TIMEOUT_MS = 30_000;

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
    throw new LinghunError({
      code: "MODEL_TOOLS_UNSUPPORTED",
      message: `模型不支持工具调用：${model}`,
      suggestion: "请切换到支持 tools 的模型，或在本轮请求中不要发送 tools/toolChoice。",
      recoverable: true,
    });
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
    return createChatProfileRequest(request, this.config);
  }

  createResponsesRequest(request: ModelRequest): OpenAiResponsesRequest {
    return createResponsesProfileRequest(request, this.config);
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<LinghunEvent> {
    this.assertReady();
    const contract = resolveProviderRuntimeContract(this.config, request);
    const body =
      contract.endpointProfile === "responses"
        ? this.createResponsesRequest(request)
        : this.createChatRequest(request);
    const response = await fetchWithProviderRetry(
      `${this.normalizedBaseUrl()}${contract.endpoint}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      },
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw createApiKeyError(response.status);
      }
      throw createHttpStatusError(response.status, await safeReadResponseText(response));
    }

    if (!response.body) {
      throw new LinghunError({
        code: "PROVIDER_STREAM_EMPTY",
        message: "模型请求失败：响应中没有可读取的流。",
        suggestion: `请确认 base_url 支持 ${contract.profile} 的 ${contract.endpoint} 流式接口。`,
        recoverable: true,
      });
    }

    yield* parseOpenAiStream(
      withStreamIdleTimeout(response.body, PROVIDER_STREAM_IDLE_TIMEOUT_MS, signal),
      contract.endpointProfile === "responses" ? "/v1/responses" : "/v1/chat/completions",
    );
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

function resolveProviderRuntimeContract(
  config: ProviderConfig,
  request: ModelRequest,
): ProviderRuntimeContract {
  if (config.type === "deepseek") {
    return {
      profile: "deepseek_chat_completions",
      endpointProfile: "chat_completions",
      endpoint: "/chat/completions",
      toolResultShape: "chat_tool_message",
    };
  }
  const endpointProfile = request.endpointProfile ?? config.endpointProfile ?? "chat_completions";
  if (endpointProfile === "responses") {
    return {
      profile: "openai_responses",
      endpointProfile,
      endpoint: "/responses",
      toolResultShape: "responses_function_call_output",
    };
  }
  return {
    profile: "openai_compatible_chat_completions",
    endpointProfile: "chat_completions",
    endpoint: "/chat/completions",
    toolResultShape: "chat_tool_message",
  };
}

async function fetchWithProviderRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!PROVIDER_RETRY_STATUSES.has(response.status) || attempt === PROVIDER_MAX_ATTEMPTS) {
        return response;
      }
      await sleep(readRetryAfterMs(response) ?? PROVIDER_BASE_RETRY_MS * 2 ** (attempt - 1));
    } catch (error) {
      lastError = error;
      if (!(error instanceof TypeError) || attempt === PROVIDER_MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(PROVIDER_BASE_RETRY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function readRetryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function safeReadResponseText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function withStreamIdleTimeout(
  body: ReadableStream<Uint8Array>,
  timeoutMs: number,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new LinghunError({
              code: "PROVIDER_STREAM_TIMEOUT",
              message: `模型请求失败：流式响应超过 ${timeoutMs}ms 没有新数据。`,
              suggestion:
                "请稍后重试，或运行 /model doctor 检查 provider/model、网络和网关稳定性。",
              recoverable: true,
            }),
          );
        }, timeoutMs);
        signal.addEventListener(
          "abort",
          () => {
            if (timer) clearTimeout(timer);
          },
          { once: true },
        );
      });
      const result = await Promise.race([reader.read(), timeout]);
      if (timer) clearTimeout(timer);
      if (result.done) {
        controller.close();
        return;
      }
      controller.enqueue(result.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function createChatProfileRequest(
  request: ModelRequest,
  config: ProviderConfig,
): OpenAiChatRequest {
  if (request.endpointProfile === "responses") {
    throw new LinghunError({
      code: "PROVIDER_PROFILE_MISMATCH",
      message: "Provider profile mismatch: chat request builder received responses profile.",
      suggestion: "请检查 endpointProfile；chat_completions 与 responses schema 不能混用。",
      recoverable: true,
    });
  }
  const model = request.model ?? config.model;
  const tools = createOpenAiChatTools(request, config.supportsTools);
  return {
    model,
    messages: request.messages.map(toOpenAiMessage),
    stream: true,
    max_tokens: resolveMaxOutputTokens(model, request, config),
    ...(tools && tools.length > 0 ? { tools, tool_choice: request.toolChoice ?? "auto" } : {}),
  };
}

function createResponsesProfileRequest(
  request: ModelRequest,
  config: ProviderConfig,
): OpenAiResponsesRequest {
  if (request.endpointProfile && request.endpointProfile !== "responses") {
    throw new LinghunError({
      code: "PROVIDER_PROFILE_MISMATCH",
      message: "Provider profile mismatch: responses request builder received chat profile.",
      suggestion: "请检查 endpointProfile；chat_completions 与 responses schema 不能混用。",
      recoverable: true,
    });
  }
  const model = request.model ?? config.model;
  const tools = createOpenAiResponsesTools(request, config.supportsTools);
  return {
    model,
    input: request.messages.flatMap(toOpenAiResponsesInputItem),
    stream: true,
    max_output_tokens: resolveMaxOutputTokens(model, request, config),
    ...(tools && tools.length > 0 ? { tools, tool_choice: request.toolChoice ?? "auto" } : {}),
    ...createReasoningPayload(request.reasoningLevel ?? config.reasoningLevel),
  };
}

function resolveMaxOutputTokens(
  model: string,
  request: ModelRequest,
  config: ProviderConfig,
): number {
  const known = findKnownModel(model);
  const maxAllowed = known?.maxOutputTokens ?? config.maxOutputTokens ?? 4_096;
  const requested = request.maxOutputTokens ?? config.maxOutputTokens ?? maxAllowed;
  return Math.min(requested, maxAllowed);
}

function createOpenAiChatTools(
  request: ModelRequest,
  supportsTools: boolean | undefined,
): OpenAiToolDefinition[] | undefined {
  if (supportsTools === false) {
    return undefined;
  }
  return request.tools?.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function createOpenAiResponsesTools(
  request: ModelRequest,
  supportsTools: boolean | undefined,
): OpenAiResponsesToolDefinition[] | undefined {
  if (supportsTools === false) {
    return undefined;
  }
  return request.tools?.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

function createReasoningPayload(level: string | undefined): { reasoning?: { effort: string } } {
  if (!level) {
    return {};
  }
  return { reasoning: { effort: level } };
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

function toOpenAiResponsesInputItem(message: ModelMessage): OpenAiResponsesInputItem[] {
  if (message.role === "assistant") {
    const items: OpenAiResponsesInputItem[] = [];
    if (message.content) {
      items.push({ role: "assistant", content: message.content });
    }
    for (const toolCall of message.toolCalls ?? []) {
      items.push({
        type: "function_call",
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.input ?? {}),
      });
    }
    return items;
  }
  if (message.role === "tool") {
    return [
      {
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content,
      },
    ];
  }
  return [message];
}

export async function* parseOpenAiStream(
  body: ReadableStream<Uint8Array>,
  endpoint = "/v1/chat/completions",
): AsyncGenerator<LinghunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state: OpenAiStreamParseState = {
    pendingToolCalls: new Map(),
    pendingResponsesToolCalls: new Map(),
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
      for (const event of parseOpenAiStreamLine(line, state, endpoint)) {
        yield event;
      }
    }
  }

  const tail = decoder.decode();
  if (tail) {
    buffer += tail;
  }
  for (const event of parseOpenAiStreamLine(buffer, state, endpoint)) {
    yield event;
  }
  if (state.pendingToolCalls.size > 0 || state.pendingResponsesToolCalls.size > 0) {
    yield {
      type: "error",
      error: new LinghunError({
        code: "PROVIDER_PARTIAL_TOOL_CALL",
        message: "模型请求失败：流结束时仍有未完成的 tool call。",
        suggestion:
          "请重试；如持续出现，运行 /model doctor 检查 provider 的 tool calling 流式兼容性或切换 endpoint profile。",
        recoverable: true,
      }),
    };
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
  pendingResponsesToolCalls: Map<number, PendingResponsesToolCall>;
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

type ResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
};

function parseOpenAiStreamLine(
  line: string,
  state: OpenAiStreamParseState,
  endpoint = "/v1/chat/completions",
): LinghunEvent[] {
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
    type?: string;
    output_index?: number;
    delta?: string;
    item?: { type?: string; call_id?: string; id?: string; name?: string; arguments?: string };
    response?: { id?: string; usage?: ResponsesUsage };
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

  const responseEvents = parseResponsesEvent(parsed, state, endpoint);
  if (responseEvents.length > 0) {
    return responseEvents;
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
        endpoint,
      },
    });
  }
  return events;
}

function parseResponsesEvent(
  parsed: {
    id?: string;
    type?: string;
    output_index?: number;
    delta?: string;
    item?: { type?: string; call_id?: string; id?: string; name?: string; arguments?: string };
    response?: { id?: string; usage?: ResponsesUsage };
    usage?: OpenAiStreamUsage;
  },
  state: OpenAiStreamParseState,
  endpoint: string,
): LinghunEvent[] {
  if (!parsed.type?.startsWith("response.")) {
    return [];
  }
  if (parsed.type === "response.failed" || parsed.type === "response.incomplete") {
    return [
      {
        type: "error",
        error: new LinghunError({
          code: "PROVIDER_STREAM_ERROR",
          message: `模型请求失败：Responses endpoint 返回 ${parsed.type}。`,
          suggestion:
            "请运行 /model doctor 检查 endpoint profile、model、reasoning 和 provider 兼容性。",
          recoverable: true,
        }),
      },
    ];
  }
  if (parsed.response?.id) {
    state.lastId = parsed.response.id;
  }
  if (parsed.type === "response.output_text.delta" && parsed.delta) {
    return [{ type: "assistant_text_delta", id: parsed.id ?? state.lastId, text: parsed.delta }];
  }
  if (
    (parsed.type === "response.reasoning_summary_text.delta" ||
      parsed.type === "response.reasoning_text.delta") &&
    parsed.delta
  ) {
    return [
      { type: "assistant_thinking_delta", id: parsed.id ?? state.lastId, text: parsed.delta },
    ];
  }
  if (parsed.type === "response.output_item.added" && parsed.item?.type === "function_call") {
    const index = parsed.output_index ?? state.pendingResponsesToolCalls.size;
    state.pendingResponsesToolCalls.set(index, {
      id: parsed.item.call_id ?? parsed.item.id ?? `tool-${index + 1}`,
      name: parsed.item.name ?? "",
      arguments: parsed.item.arguments ?? "",
    });
    return [];
  }
  if (parsed.type === "response.function_call_arguments.delta" && parsed.delta) {
    const index = parsed.output_index ?? 0;
    const existing = state.pendingResponsesToolCalls.get(index) ?? {
      id: `tool-${index + 1}`,
      name: "",
      arguments: "",
    };
    state.pendingResponsesToolCalls.set(index, {
      ...existing,
      arguments: existing.arguments + parsed.delta,
    });
    return [];
  }
  if (parsed.type === "response.output_item.done" && parsed.item?.type === "function_call") {
    const index = parsed.output_index ?? 0;
    const existing = state.pendingResponsesToolCalls.get(index);
    state.pendingResponsesToolCalls.delete(index);
    const id = parsed.item.call_id ?? parsed.item.id ?? existing?.id ?? `tool-${index + 1}`;
    const name = parsed.item.name ?? existing?.name ?? "unknown";
    const args = parsed.item.arguments ?? existing?.arguments ?? "{}";
    return [
      {
        type: "tool_use",
        id,
        name,
        input: parseToolArguments(args),
      },
    ];
  }
  const usage = parsed.response?.usage;
  if (parsed.type === "response.completed" && usage) {
    state.hadUsage = true;
    return [
      {
        type: "usage",
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
          cacheReadTokens: usage.input_tokens_details?.cached_tokens,
          cacheWriteTokens: undefined,
          cacheWriteTokensRaw: null,
          rawUsage: usage,
          endpoint,
        },
      },
    ];
  }
  return [];
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

function createHttpStatusError(status: number, responseText?: string): LinghunError {
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
