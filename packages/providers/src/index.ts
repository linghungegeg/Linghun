import { LinghunError } from "@linghun/core";

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type LinghunEvent =
  | { type: "assistant_text_delta"; id: string; text: string }
  | { type: "usage"; usage: ModelUsage }
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
};

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelRequest = {
  messages: ModelMessage[];
  model?: string;
  maxOutputTokens?: number;
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
  messages: ModelMessage[];
  stream: true;
  max_tokens: number;
};

export const deepSeekModels: ModelInfo[] = [
  {
    id: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    providerId: "deepseek",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsTools: false,
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
    supportsTools: false,
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
      yield* provider.stream(request, signal);
    } catch (error) {
      const linghunError = normalizeProviderError(error);
      yield { type: "error", error: linghunError };
    }
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
        supportsTools: false,
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
    return {
      model,
      messages: request.messages,
      stream: true,
      max_tokens: Math.min(requested, maxAllowed),
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
      throw new LinghunError({
        code: "PROVIDER_HTTP_ERROR",
        message: `模型请求失败：HTTP ${response.status}。`,
        suggestion: "请运行 /model doctor 检查 API Key、base_url 和模型名称。",
        recoverable: response.status >= 400 && response.status < 500,
      });
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

export async function* parseOpenAiStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<LinghunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      for (const event of parseOpenAiStreamLine(line)) {
        yield event;
      }
    }
  }

  const tail = decoder.decode();
  if (tail) {
    buffer += tail;
  }
  for (const event of parseOpenAiStreamLine(buffer)) {
    yield event;
  }
}

function parseOpenAiStreamLine(line: string): LinghunEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return [];
  }
  const payload = trimmed.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") {
    return [];
  }
  const parsed = JSON.parse(payload) as {
    id?: string;
    choices?: { delta?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const events: LinghunEvent[] = [];
  const text = parsed.choices?.[0]?.delta?.content;
  if (text) {
    events.push({ type: "assistant_text_delta", id: parsed.id ?? "assistant", text });
  }
  if (parsed.usage) {
    events.push({
      type: "usage",
      usage: {
        inputTokens: parsed.usage.prompt_tokens ?? 0,
        outputTokens: parsed.usage.completion_tokens ?? 0,
        totalTokens: parsed.usage.total_tokens ?? 0,
      },
    });
  }
  return events;
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
