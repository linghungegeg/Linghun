import { LinghunError } from "@linghun/core";
import { LINGHUN_CLI_NAME, LINGHUN_NAME, LINGHUN_VERSION } from "@linghun/shared";

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheWriteTokensRaw?: number | null;
  cacheWriteTokensEstimated?: boolean;
  // D.13F：Anthropic prompt cache 显式 cache_control 时，message_start/message_delta 的
  // usage.cache_creation 会带上 ephemeral_5m_input_tokens / ephemeral_1h_input_tokens；
  // 仅作只读统计使用，OpenAI 兼容路径不会写这两个字段。
  cacheCreationEphemeral5mTokens?: number;
  cacheCreationEphemeral1hTokens?: number;
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

export type EndpointProfile = "chat_completions" | "responses" | "anthropic_messages";
export type ProviderCompatibilityProfile =
  | "deepseek"
  | "strict_openai_compatible"
  | "permissive_openai_compatible"
  | "anthropic_messages";
export type ProviderRuntimeProfile =
  | "deepseek_chat_completions"
  | "strict_openai_compatible_chat_completions"
  | "permissive_openai_compatible_chat_completions"
  | "openai_responses"
  | "anthropic_messages";

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
  compatibilityProfile?: ProviderCompatibilityProfile;
  reasoningLevel?: string;
  includeUsage?: boolean;
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
  // D.13F：prompt cache 输入。enabled 默认由上层（TUI/runtime）解析后注入；
  // promptCacheTtl 只支持 "1h" 显式传，不传等于 5m 默认（cache_control 不写 ttl 字面量）。
  // cacheBreakNonce 由 TUI/runtime 根据 once/always 标记文件计算后注入；provider 不读不写文件。
  promptCacheEnabled?: boolean;
  promptCacheTtl?: "1h";
  cacheBreakNonce?: string;
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
  stream_options?: { include_usage: true };
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

// ---------------------------------------------------------------------------
// Anthropic Messages (/v1/messages) — request / stream event shapes
// ---------------------------------------------------------------------------
// 仅覆盖 Linghun 当前需要的字段：text 流、message_start/stop、usage 和 error。
// Tools 在本轮 anthropic_messages profile 上禁用（contract.supportsTools=false），
// 因此暂不实现 tool_use / tool_result / input_json_delta 路径。
// D.13F：system 字段支持 string 与 block-array 两种形态，block 形态用于挂 cache_control。
// 默认 5m：cache_control 只传 { type: "ephemeral" }，不传 ttl: "5m" 字面量。
// 1h 仅在用户显式 promptCache.systemTtl="1h" 时设 ttl: "1h"，不附加 beta header。
type AnthropicMessage = { role: "user"; content: string } | { role: "assistant"; content: string };

export type AnthropicCacheControl = { type: "ephemeral"; ttl?: "1h" };

export type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
};

export type AnthropicMessagesRequest = {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  stream: true;
  system?: string | AnthropicSystemBlock[];
};

type AnthropicStreamEvent =
  | { type: "message_start"; message?: { id?: string; usage?: AnthropicUsage } }
  | { type: "content_block_start"; index?: number }
  | {
      type: "content_block_delta";
      index?: number;
      delta?: { type?: string; text?: string };
    }
  | { type: "content_block_stop"; index?: number }
  | { type: "message_delta"; delta?: { stop_reason?: string }; usage?: AnthropicUsage }
  | { type: "message_stop" }
  | { type: "ping" }
  | {
      type: "error";
      error?: { type?: string; message?: string };
    };

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  // D.13F：Anthropic explicit cache_control 时，cache_creation 会按 ttl 拆分到这两个子字段。
  // 不传 ttl 时仍只看 cache_creation_input_tokens；ephemeral_5m / 1h 字段为只读统计。
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
};

export type ProviderRuntimeContract = {
  profile: ProviderRuntimeProfile;
  endpointProfile: EndpointProfile;
  endpoint: "/chat/completions" | "/responses" | "/v1/messages";
  compatibilityProfile: ProviderCompatibilityProfile;
  supportsTools: boolean;
  sendReasoning: boolean;
  includeUsage: boolean;
  toolSchemaShape:
    | "openai_chat_tools"
    | "openai_responses_tools"
    | "anthropic_tools"
    | "tools_disabled";
  toolResultShape:
    | "chat_tool_message"
    | "responses_function_call_output"
    | "anthropic_tool_result"
    | "tools_disabled";
  retryStatuses: number[];
  maxAttempts: number;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
};

export type ProviderBaseUrlEndpointSuffix = "chat_completions" | "responses" | "anthropic_messages";

export type ProviderBaseUrlDiagnostic = {
  originalBaseUrl?: string;
  normalizedBaseUrl: string;
  fullEndpointSuffix?: ProviderBaseUrlEndpointSuffix;
  endpointPath: string;
  profileMismatch: boolean;
  hasQueryOrFragment: boolean;
  recommendation?: string;
};

const PROVIDER_RETRY_STATUSES = new Set([429, 502, 503, 504]);
const PROVIDER_MAX_ATTEMPTS = 3;
const PROVIDER_BASE_RETRY_MS = 500;
const PROVIDER_STREAM_IDLE_TIMEOUT_MS = 30_000;
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;
const LINGHUN_REQUEST_PACKAGE_NAME = `@linghun/${LINGHUN_CLI_NAME}`;
const LINGHUN_REQUEST_IDENTITY_HEADERS = {
  "User-Agent": `${LINGHUN_NAME}/${LINGHUN_VERSION} (${LINGHUN_REQUEST_PACKAGE_NAME})`,
  "X-Title": LINGHUN_NAME,
  "X-OpenRouter-Title": LINGHUN_NAME,
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
      // 注：空响应识别（chunkCount=0 / 无文本 / 仅 usage）由 model-loop 一侧基于
      // message_stop 与累计的 assistantText 判定，并走现存的中文友好降级文案，
      // 详见 tui/src/index.ts streamFinalModelAnswerWithoutTools 与
      // recordProviderEmptyResponse / formatProviderEmptyResponsePrimary。
      // 此处不在 gateway 再 yield PROVIDER_EMPTY_RESPONSE error 事件，避免覆盖现存路径。
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

export function resolveProviderBaseUrlDiagnostic(
  baseUrl: string | undefined,
  endpointProfile: EndpointProfile = "chat_completions",
): ProviderBaseUrlDiagnostic {
  const originalBaseUrl = baseUrl;
  let normalizedBaseUrl = baseUrl?.replace(/\/+$/, "") ?? "";
  let fullEndpointSuffix: ProviderBaseUrlEndpointSuffix | undefined;
  if (normalizedBaseUrl.endsWith("/chat/completions")) {
    normalizedBaseUrl = normalizedBaseUrl.slice(0, -"/chat/completions".length);
    fullEndpointSuffix = "chat_completions";
  } else if (normalizedBaseUrl.endsWith("/responses")) {
    normalizedBaseUrl = normalizedBaseUrl.slice(0, -"/responses".length);
    fullEndpointSuffix = "responses";
  } else if (normalizedBaseUrl.endsWith("/v1/messages")) {
    normalizedBaseUrl = normalizedBaseUrl.slice(0, -"/v1/messages".length);
    fullEndpointSuffix = "anthropic_messages";
  }
  const endpoint =
    endpointProfile === "responses"
      ? "/responses"
      : endpointProfile === "anthropic_messages"
        ? "/v1/messages"
        : "/chat/completions";
  const endpointPath = resolveFinalEndpointPath(normalizedBaseUrl, endpoint);
  const profileMismatch = Boolean(fullEndpointSuffix && fullEndpointSuffix !== endpointProfile);
  const hasQueryOrFragment = hasBaseUrlQueryOrFragment(normalizedBaseUrl);
  const recommendation = fullEndpointSuffix
    ? "baseUrl 应填根路径，例如 https://example.com/v1；endpointProfile 使用 chat_completions / responses / anthropic_messages，不要把完整 endpoint 写进 baseUrl。"
    : hasQueryOrFragment
      ? "baseUrl 应填不含 query/fragment 的根路径，例如 https://example.com/v1；私有 token 或路由参数不要放进 baseUrl。"
      : undefined;
  return {
    originalBaseUrl,
    normalizedBaseUrl,
    fullEndpointSuffix,
    endpointPath,
    profileMismatch,
    hasQueryOrFragment,
    recommendation,
  };
}

function resolveFinalEndpointPath(baseUrl: string, endpoint: string): string {
  try {
    return new URL(joinBaseUrlAndEndpoint(baseUrl, endpoint)).pathname;
  } catch {
    return endpoint;
  }
}

/**
 * 拼接 baseUrl + endpoint，处理 baseUrl 已经包含 /v1 路径段的情况：
 *   baseUrl=https://api.anthropic.com         endpoint=/v1/messages → /v1/messages
 *   baseUrl=https://api.anthropic.com/v1      endpoint=/v1/messages → /v1/messages（去重）
 *   baseUrl=https://api.anthropic.com/v1/     endpoint=/v1/messages → /v1/messages
 *   baseUrl=https://relay.example.com/api/v1  endpoint=/v1/messages → /api/v1/messages（去重 path 末尾 /v1）
 *   baseUrl=https://relay.example.com         endpoint=/chat/completions → /chat/completions
 *   baseUrl=https://relay.example.com/v1      endpoint=/chat/completions → /v1/chat/completions（不去重）
 *
 * normalizedBaseUrl 已经在 resolveProviderBaseUrlDiagnostic 中剥掉了 /v1/messages、
 * /chat/completions、/responses 完整 endpoint suffix，但保留可能存在的中间 /v1 段。
 * 仅在 endpoint 自身以 /v1/ 开头时（目前仅 anthropic_messages → /v1/messages）做去重。
 */
export function joinBaseUrlAndEndpoint(baseUrl: string, endpoint: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  if (!endpoint.startsWith("/v1/")) {
    return `${trimmedBase}${endpoint}`;
  }
  // endpoint 形如 /v1/messages：若 baseUrl path 末尾恰好是 /v1，则去重避免 /v1/v1/messages。
  if (/\/v1$/.test(trimmedBase)) {
    return `${trimmedBase}${endpoint.slice("/v1".length)}`;
  }
  return `${trimmedBase}${endpoint}`;
}

function hasBaseUrlQueryOrFragment(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return Boolean(parsed.search || parsed.hash);
  } catch {
    return false;
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

  createAnthropicMessagesRequest(request: ModelRequest): AnthropicMessagesRequest {
    return createAnthropicMessagesProfileRequest(request, this.config);
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<LinghunEvent> {
    this.assertReady();
    const contract = resolveProviderRuntimeContract(this.config, request);
    const baseUrlDiagnostic = resolveProviderBaseUrlDiagnostic(
      this.config.baseUrl,
      contract.endpointProfile,
    );
    const url = joinBaseUrlAndEndpoint(baseUrlDiagnostic.normalizedBaseUrl, contract.endpoint);

    if (contract.endpointProfile === "anthropic_messages") {
      const body = this.createAnthropicMessagesRequest(request);
      const response = await fetchWithProviderRetry(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...LINGHUN_REQUEST_IDENTITY_HEADERS,
          // Anthropic Messages 鉴权头：x-api-key + anthropic-version。
          // 部分中转网关沿用 OpenAI 风格 Authorization: Bearer，因此并发发送两套头，
          // Anthropic 官方接口忽略 Authorization，OpenAI 风格中转忽略 x-api-key/version。
          "x-api-key": this.config.apiKey ?? "",
          "anthropic-version": "2023-06-01",
          authorization: `Bearer ${this.config.apiKey ?? ""}`,
          accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw createApiKeyError(response.status);
        }
        throw createHttpStatusError(
          response.status,
          await safeReadResponseText(response),
          this.config.type,
        );
      }

      if (!response.body) {
        throw new LinghunError({
          code: "PROVIDER_STREAM_EMPTY",
          message: "模型请求失败：响应中没有可读取的流。",
          suggestion: `请确认 base_url 支持 ${contract.profile} 的 ${contract.endpoint} 流式接口。`,
          recoverable: true,
        });
      }

      yield* parseAnthropicMessagesStream(
        withStreamIdleTimeout(response.body, PROVIDER_STREAM_IDLE_TIMEOUT_MS, signal),
        contract.endpoint,
      );
      return;
    }

    const body =
      contract.endpointProfile === "responses"
        ? this.createResponsesRequest(request)
        : this.createChatRequest(request);
    const response = await fetchWithProviderRetry(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...LINGHUN_REQUEST_IDENTITY_HEADERS,
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw createApiKeyError(response.status);
      }
      throw createHttpStatusError(
        response.status,
        await safeReadResponseText(response),
        this.config.type,
      );
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
        suggestion: "请为当前 provider 设置兼容的 base_url，然后运行 /model doctor 复查。",
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
}

export function resolveProviderRuntimeContract(
  config: ProviderConfig,
  request: ModelRequest = { messages: [] },
): ProviderRuntimeContract {
  const supportsTools = config.supportsTools !== false;
  if (config.type === "deepseek") {
    return {
      profile: "deepseek_chat_completions",
      endpointProfile: "chat_completions",
      endpoint: "/chat/completions",
      compatibilityProfile: "deepseek",
      supportsTools,
      sendReasoning: false,
      includeUsage: config.includeUsage === true,
      toolSchemaShape: "openai_chat_tools",
      toolResultShape: "chat_tool_message",
      retryStatuses: [...PROVIDER_RETRY_STATUSES],
      maxAttempts: PROVIDER_MAX_ATTEMPTS,
      requestTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      streamIdleTimeoutMs: PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    };
  }
  // 决策有效协议：调用 resolveEffectiveEndpointProfile，遵循以下优先级（高到低）：
  //   1. request.endpointProfile（per-request override）
  //   2. baseUrl suffix（/v1/messages、/chat/completions、/responses 是真实路由）
  //   3. Claude 模型 + (config.endpointProfile 为空或 chat_completions) → 自动 anthropic_messages
  //      （chat_completions 一律视为占位，无论来源；与 Claude /v1/messages schema 不兼容）
  //   4. config.endpointProfile 显式非 chat（responses / anthropic_messages / 非 Claude 的 chat_completions）
  //   5. 缺省 chat_completions
  // 决策不改写 config，只返回 effective endpointProfile + source/reason/warnings 给 doctor 展示。
  const effective = resolveEffectiveEndpointProfile({
    requestEndpointProfile: request.endpointProfile,
    configEndpointProfile: config.endpointProfile,
    configBaseUrl: config.baseUrl,
    configModel: config.model,
    requestModel: request.model,
  });
  const endpointProfile = effective.endpointProfile;
  const compatibilityProfile =
    config.compatibilityProfile ??
    (endpointProfile === "anthropic_messages" ? "anthropic_messages" : "strict_openai_compatible");
  if (endpointProfile === "anthropic_messages") {
    return {
      profile: "anthropic_messages",
      endpointProfile,
      endpoint: "/v1/messages",
      compatibilityProfile,
      // 本轮 anthropic_messages profile 强制禁用 tools：
      // 上游显式声明 supportsTools=false，确保 ModelGateway.withSupportedTools
      // 在带 tools 的请求上抛 MODEL_TOOLS_UNSUPPORTED 而不是静默丢弃。
      supportsTools: false,
      sendReasoning: false,
      includeUsage: false,
      toolSchemaShape: "tools_disabled",
      toolResultShape: "tools_disabled",
      retryStatuses: [...PROVIDER_RETRY_STATUSES],
      maxAttempts: PROVIDER_MAX_ATTEMPTS,
      requestTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      streamIdleTimeoutMs: PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    };
  }
  if (endpointProfile === "responses") {
    return {
      profile: "openai_responses",
      endpointProfile,
      endpoint: "/responses",
      compatibilityProfile,
      supportsTools,
      sendReasoning: Boolean(request.reasoningLevel ?? config.reasoningLevel),
      includeUsage: config.includeUsage === true,
      toolSchemaShape: "openai_responses_tools",
      toolResultShape: "responses_function_call_output",
      retryStatuses: [...PROVIDER_RETRY_STATUSES],
      maxAttempts: PROVIDER_MAX_ATTEMPTS,
      requestTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      streamIdleTimeoutMs: PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    };
  }
  return {
    profile:
      compatibilityProfile === "permissive_openai_compatible"
        ? "permissive_openai_compatible_chat_completions"
        : "strict_openai_compatible_chat_completions",
    endpointProfile: "chat_completions",
    endpoint: "/chat/completions",
    compatibilityProfile,
    supportsTools,
    sendReasoning:
      compatibilityProfile === "permissive_openai_compatible" &&
      Boolean(request.reasoningLevel ?? config.reasoningLevel),
    includeUsage: config.includeUsage === true,
    toolSchemaShape: "openai_chat_tools",
    toolResultShape: "chat_tool_message",
    retryStatuses: [...PROVIDER_RETRY_STATUSES],
    maxAttempts: PROVIDER_MAX_ATTEMPTS,
    requestTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    streamIdleTimeoutMs: PROVIDER_STREAM_IDLE_TIMEOUT_MS,
  };
}

/**
 * 决策器：从 (request endpointProfile, config endpointProfile, config baseUrl, model)
 * 推断当前请求实际生效的 EndpointProfile。
 *
 * 规则（高优先级到低）：
 *   1. request.endpointProfile 显式提供 → 直接生效（per-request override）。
 *   2. baseUrl suffix（/v1/messages、/chat/completions、/responses）→ 反推 endpointProfile，
 *      并在与 config.endpointProfile 不一致时给 warning（baseUrl 是用户写死的真实路由）。
 *   3. 模型名匹配 Claude 系列（claude-* / claude_*）+ config.endpointProfile 为空或
 *      "chat_completions"（无论来源是 provider.env 旧 setup 默认还是用户 settings 显式声明）
 *      → 自动选 anthropic_messages，避免 chat_completions 与 Claude /v1/messages 协议不兼容。
 *      本轮策略：Claude + chat_completions 一律视为占位，不区分声明来源；如果用户确实想
 *      把 Claude 走 chat_completions，应该改用支持 OpenAI Chat schema 的中转模型（不是 claude-*）。
 *      此路径下记录 source=auto-claude-model，reason 解释为何覆盖了 chat_completions。
 *   4. config.endpointProfile 显式提供（responses / anthropic_messages / 非 Claude 的
 *      chat_completions）→ 直接生效。
 *   5. 缺省 → chat_completions。
 *
 * 同时返回 source、reason、warnings，供 /model doctor 对用户解释当前选择。
 * 决策不改写 config，调用方自行决定是否要持久化。
 */
export type EffectiveEndpointProfileSource =
  | "request"
  | "config-explicit"
  | "base-url-suffix"
  | "auto-claude-model"
  | "default-chat-completions";

export type EffectiveEndpointProfileResult = {
  endpointProfile: EndpointProfile;
  source: EffectiveEndpointProfileSource;
  reason: string;
  warnings: string[];
};

const CLAUDE_MODEL_PATTERN = /^claude[-_]/i;

export function resolveEffectiveEndpointProfile(input: {
  requestEndpointProfile?: EndpointProfile;
  configEndpointProfile?: EndpointProfile;
  configBaseUrl?: string;
  configModel?: string;
  requestModel?: string;
}): EffectiveEndpointProfileResult {
  const warnings: string[] = [];
  const baseUrlSuffix = inferEndpointProfileFromBaseUrl(input.configBaseUrl);
  const model = input.requestModel ?? input.configModel;
  const modelLooksClaude = Boolean(model && CLAUDE_MODEL_PATTERN.test(model));

  // 1. request 级 override 最高优先：per-request 显式声明应当生效。
  if (input.requestEndpointProfile) {
    if (baseUrlSuffix && baseUrlSuffix !== input.requestEndpointProfile) {
      warnings.push(
        `request endpointProfile=${input.requestEndpointProfile} 与 baseUrl suffix=${baseUrlSuffix} 不一致；以 request 为准`,
      );
    }
    return {
      endpointProfile: input.requestEndpointProfile,
      source: "request",
      reason: "request 显式声明 endpointProfile",
      warnings,
    };
  }

  // 2. baseUrl 完整 endpoint suffix 是用户写死的真实路由，应优先反推 endpointProfile，
  //    避免 provider.env 的 chat_completions 占位与 Anthropic 中转 baseUrl 矛盾时仍走 chat。
  if (baseUrlSuffix) {
    if (input.configEndpointProfile && input.configEndpointProfile !== baseUrlSuffix) {
      warnings.push(
        `config endpointProfile=${input.configEndpointProfile} 与 baseUrl suffix=${baseUrlSuffix} 不一致；以 baseUrl 为准（baseUrl 是真实路由），建议把 baseUrl 改为根路径或对齐 endpointProfile`,
      );
    }
    return {
      endpointProfile: baseUrlSuffix,
      source: "base-url-suffix",
      reason: `baseUrl 以 ${baseUrlSuffix === "anthropic_messages" ? "/v1/messages" : baseUrlSuffix === "responses" ? "/responses" : "/chat/completions"} 结尾`,
      warnings,
    };
  }

  // 3. Claude 模型 + (config.endpointProfile 为空 / chat_completions) → 自动 anthropic_messages。
  //    本轮策略：Claude + chat_completions 一律视为占位（无论来自 provider.env 默认还是用户
  //    settings 显式声明），因为 chat_completions schema 与 Claude /v1/messages 不兼容；
  //    如需走 OpenAI Chat 协议，应改用非 claude-* 的中转模型。
  //    用户显式 responses / anthropic_messages 时不会走到这一步（落到第 4 条）。
  const configIsChatPlaceholder =
    !input.configEndpointProfile || input.configEndpointProfile === "chat_completions";
  if (modelLooksClaude && configIsChatPlaceholder) {
    return {
      endpointProfile: "anthropic_messages",
      source: "auto-claude-model",
      reason: input.configEndpointProfile
        ? `model=${model} 是 Claude 系列；config endpointProfile=chat_completions 与 Claude /v1/messages schema 不兼容，一律视为占位，自动切 anthropic_messages`
        : `model=${model} 是 Claude 系列，未配置 endpointProfile，自动选 anthropic_messages`,
      warnings,
    };
  }

  // 4. config 显式声明 endpointProfile（responses / anthropic_messages / 非 Claude 的 chat_completions）。
  if (input.configEndpointProfile) {
    if (input.configEndpointProfile !== "anthropic_messages" && modelLooksClaude) {
      warnings.push(
        `model=${model} 看起来是 Claude 系列，但 endpointProfile=${input.configEndpointProfile}；如果 base_url 是 Anthropic 中转，建议改为 anthropic_messages`,
      );
    }
    return {
      endpointProfile: input.configEndpointProfile,
      source: "config-explicit",
      reason: "config 显式声明 endpointProfile",
      warnings,
    };
  }

  // 5. 缺省。
  return {
    endpointProfile: "chat_completions",
    source: "default-chat-completions",
    reason: "未配置 endpointProfile，且模型不像 Claude，缺省 chat_completions",
    warnings,
  };
}

function inferEndpointProfileFromBaseUrl(baseUrl: string | undefined): EndpointProfile | undefined {
  if (!baseUrl) return undefined;
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/messages")) return "anthropic_messages";
  if (trimmed.endsWith("/chat/completions")) return "chat_completions";
  if (trimmed.endsWith("/responses")) return "responses";
  return undefined;
}

async function fetchWithProviderRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithRequestTimeout(url, init, PROVIDER_REQUEST_TIMEOUT_MS);
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

async function fetchWithRequestTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const timeoutError = createProviderRequestTimeoutError(timeoutMs);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  const request = fetch(url, { ...init, signal: controller.signal }).catch((error: unknown) => {
    if (timedOut) {
      throw timeoutError;
    }
    throw error;
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function createProviderRequestTimeoutError(timeoutMs: number): LinghunError {
  return new LinghunError({
    code: "PROVIDER_REQUEST_TIMEOUT",
    message: `模型请求失败：等待 provider 响应头超过 ${timeoutMs}ms。`,
    suggestion:
      "请检查网络、provider/baseUrl/model 是否可用；如持续超时，运行 /model doctor 或切换 provider/model 后重试。",
    recoverable: true,
  });
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
  const contract = resolveProviderRuntimeContract(config, request);
  const model = request.model ?? config.model;
  const tools = createOpenAiChatTools(request, contract);
  return {
    model,
    messages: request.messages.map(toOpenAiMessage),
    stream: true,
    max_tokens: resolveMaxOutputTokens(model, request, config),
    ...(tools && tools.length > 0 ? { tools, tool_choice: request.toolChoice ?? "auto" } : {}),
    ...(contract.sendReasoning
      ? createReasoningPayload(request.reasoningLevel ?? config.reasoningLevel)
      : {}),
    ...(contract.includeUsage ? { stream_options: { include_usage: true as const } } : {}),
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
  const contract = resolveProviderRuntimeContract(config, request);
  const model = request.model ?? config.model;
  const tools = createOpenAiResponsesTools(request, contract);
  return {
    model,
    input: request.messages.flatMap(toOpenAiResponsesInputItem),
    stream: true,
    max_output_tokens: resolveMaxOutputTokens(model, request, config),
    ...(tools && tools.length > 0 ? { tools, tool_choice: request.toolChoice ?? "auto" } : {}),
    ...(contract.sendReasoning
      ? createReasoningPayload(request.reasoningLevel ?? config.reasoningLevel)
      : {}),
  };
}

function createAnthropicMessagesProfileRequest(
  request: ModelRequest,
  config: ProviderConfig,
): AnthropicMessagesRequest {
  if (request.endpointProfile && request.endpointProfile !== "anthropic_messages") {
    throw new LinghunError({
      code: "PROVIDER_PROFILE_MISMATCH",
      message:
        "Provider profile mismatch: anthropic_messages request builder received non-anthropic profile.",
      suggestion:
        "请检查 endpointProfile；anthropic_messages 与 chat_completions / responses schema 不能混用。",
      recoverable: true,
    });
  }
  const contract = resolveProviderRuntimeContract(config, request);
  // anthropic_messages 强制禁用 tools；如果上游误传 tools，assertToolCapability 会抛
  // MODEL_TOOLS_UNSUPPORTED；request 没带 tools 时 assert 直接放过。
  assertToolCapability(request, contract);
  const model = request.model ?? config.model;
  // Anthropic 的 system prompt 是顶层字段；从 messages 中抽出第一个 system 文本，
  // 其余 system 消息合并到 system 字段，剩下 user/assistant 按顺序保留。
  const systemSegments: string[] = [];
  const conversation: AnthropicMessage[] = [];
  for (const message of request.messages) {
    if (message.role === "system") {
      if (message.content) systemSegments.push(message.content);
      continue;
    }
    if (message.role === "user" || message.role === "assistant") {
      conversation.push({
        role: message.role,
        content: message.content,
      });
    }
    // 'tool' role 在 anthropic_messages profile 不发生（contract.supportsTools=false 已阻断）。
    // 即使上游误传，也不进入 conversation，避免破坏 Anthropic 的 user/assistant 交替契约。
  }
  const body: AnthropicMessagesRequest = {
    model,
    messages: conversation,
    max_tokens: resolveMaxOutputTokens(model, request, config),
    stream: true,
  };
  if (systemSegments.length > 0) {
    // D.13F：promptCacheEnabled=true 时，system 写为 block array，并在最后一个 block 上挂
    // cache_control（5m 默认不写 ttl 字面量；1h 显式时才写 ttl: "1h"）。
    // 关闭时仍走 string 形态，request body 不会出现 cache_control 字段，避免误触发缓存计费。
    // cacheBreakNonce 仅在 enabled 且非空时附加为最后一个 block 的注释式后缀，破坏前缀 hash。
    if (request.promptCacheEnabled) {
      const lastIndex = systemSegments.length - 1;
      const blocks: AnthropicSystemBlock[] = systemSegments.map((segment, index) => {
        const isLast = index === lastIndex;
        const text =
          isLast && request.cacheBreakNonce
            ? `${segment}\n<!-- linghun-break-cache:${request.cacheBreakNonce} -->`
            : segment;
        if (!isLast) {
          return { type: "text", text };
        }
        const cacheControl: AnthropicCacheControl =
          request.promptCacheTtl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
        return { type: "text", text, cache_control: cacheControl };
      });
      body.system = blocks;
    } else {
      body.system = systemSegments.join("\n\n");
    }
  }
  return body;
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
  contract: ProviderRuntimeContract,
): OpenAiToolDefinition[] | undefined {
  assertToolCapability(request, contract);
  // D.13F：tools 数组按 name 字典序稳定排序，避免上层迭代顺序波动破坏 OpenAI 隐式
  // prompt cache 的前缀 hash。Linghun 不传 prompt_cache_key/prompt_cache_retention，
  // 仅靠稳定顺序和 cached_tokens 观察隐式缓存命中。
  const tools = request.tools;
  if (!tools) return undefined;
  return [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => ({
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
  contract: ProviderRuntimeContract,
): OpenAiResponsesToolDefinition[] | undefined {
  assertToolCapability(request, contract);
  // D.13F：与 chat tools 一致，按 name 字典序稳定排序。
  const tools = request.tools;
  if (!tools) return undefined;
  return [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
}

function assertToolCapability(request: ModelRequest, contract: ProviderRuntimeContract): void {
  if (contract.supportsTools || (!request.tools?.length && !request.toolChoice)) {
    return;
  }
  throw new LinghunError({
    code: "MODEL_TOOLS_UNSUPPORTED",
    message: `模型/provider profile 不支持工具调用：${contract.profile}`,
    suggestion:
      "请切换到 supportsTools=true 的 provider/model，或不要发送 tools/toolChoice；Linghun 不会静默移除工具字段后伪装成功。",
    recoverable: true,
  });
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

// ---------------------------------------------------------------------------
// Anthropic Messages SSE 流解析
// ---------------------------------------------------------------------------
// Anthropic 的 SSE 块为 `event: <name>\ndata: <json>\n\n` 形式；data 行的 JSON
// 自带 `type` 字段，与 event 名一致，因此只需读取 data 行即可。本函数只覆盖
// 当前 Linghun 在 anthropic_messages profile 下需要的事件：
//   - message_start：捕获 message id 和首批 usage（input_tokens 等）
//   - content_block_delta(type=text_delta)：转成 assistant_text_delta
//   - message_delta：尾部 usage（output_tokens / cache_*）
//   - message_stop：终结流
//   - error：转成 PROVIDER_STREAM_ERROR
// 其他事件（content_block_start / content_block_stop / ping / 非 text_delta）
// 静默忽略，不产生 LinghunEvent 也不算空响应。
export async function* parseAnthropicMessagesStream(
  body: ReadableStream<Uint8Array>,
  endpoint = "/v1/messages",
): AsyncGenerator<LinghunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state: AnthropicStreamParseState = {
    chunkCount: 0,
    hadUsage: false,
    hadText: false,
    lastId: "assistant",
    inputTokens: 0,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
    rawUsage: undefined,
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE 事件以 "\n\n" 分隔；按事件粒度切，避免半截 data 行解析失败。
    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const eventBlock = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      for (const event of parseAnthropicMessagesEventBlock(eventBlock, state, endpoint)) {
        yield event;
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  const tail = decoder.decode();
  if (tail) buffer += tail;
  if (buffer.trim().length > 0) {
    for (const event of parseAnthropicMessagesEventBlock(buffer, state, endpoint)) {
      yield event;
    }
  }

  yield {
    type: "message_stop",
    id: state.lastId,
    finishReason: state.finishReason,
    chunkCount: state.chunkCount,
    hadUsage: state.hadUsage,
  };
}

type AnthropicStreamParseState = {
  chunkCount: number;
  hadUsage: boolean;
  hadText: boolean;
  lastId: string;
  finishReason?: string;
  inputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  rawUsage?: AnthropicUsage;
};

function parseAnthropicMessagesEventBlock(
  block: string,
  state: AnthropicStreamParseState,
  endpoint: string,
): LinghunEvent[] {
  // 在一个 SSE 事件块里寻找 data 行；忽略 event:、id:、retry: 等头。
  const lines = block.split("\n");
  const dataLines: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) return [];
  const payload = dataLines.join("\n");
  if (!payload || payload === "[DONE]") return [];

  let parsed: AnthropicStreamEvent;
  try {
    parsed = JSON.parse(payload) as AnthropicStreamEvent;
  } catch (error) {
    return [
      {
        type: "error",
        error: new LinghunError({
          code: "PROVIDER_MALFORMED_STREAM",
          message: "模型请求失败：provider 返回了无法解析的 Anthropic 流式 JSON。",
          suggestion:
            "请运行 /model doctor 检查 base_url 是否为 Anthropic Messages /v1/messages 接口，或切换 provider/model 后重试。",
          cause: error,
          recoverable: true,
        }),
      },
    ];
  }

  state.chunkCount += 1;

  if (parsed.type === "error") {
    const message = parsed.error?.message;
    return [
      {
        type: "error",
        error: new LinghunError({
          code: "PROVIDER_STREAM_ERROR",
          message: `模型请求失败：Anthropic Messages 流式返回错误${message ? `：${message}` : "。"}`,
          suggestion:
            "请运行 /model doctor 检查 provider/model、额度、base_url 和 anthropic-version 头是否正确。",
          recoverable: true,
        }),
      },
    ];
  }

  if (parsed.type === "message_start") {
    const id = parsed.message?.id;
    if (id) state.lastId = id;
    const usage = parsed.message?.usage;
    if (usage) {
      state.inputTokens = usage.input_tokens ?? 0;
      state.cacheReadTokens = usage.cache_read_input_tokens;
      state.cacheWriteTokens = usage.cache_creation_input_tokens;
      state.rawUsage = usage;
    }
    return [];
  }

  if (parsed.type === "content_block_delta") {
    const delta = parsed.delta;
    if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
      state.hadText = true;
      return [{ type: "assistant_text_delta", id: state.lastId, text: delta.text }];
    }
    return [];
  }

  if (parsed.type === "message_delta") {
    const stopReason = parsed.delta?.stop_reason;
    if (stopReason) state.finishReason = stopReason;
    const usage = parsed.usage;
    if (!usage) return [];
    state.hadUsage = true;
    const merged: AnthropicUsage = { ...(state.rawUsage ?? {}), ...usage };
    state.rawUsage = merged;
    const inputTokens = merged.input_tokens ?? state.inputTokens ?? 0;
    const outputTokens = merged.output_tokens ?? 0;
    const cacheReadTokens = merged.cache_read_input_tokens ?? state.cacheReadTokens;
    const cacheWriteTokensRaw = merged.cache_creation_input_tokens ?? state.cacheWriteTokens;
    // D.13F：cache_creation 拆分到 ephemeral_5m / ephemeral_1h，仅作只读统计透出。
    const ephemeral5m = merged.cache_creation?.ephemeral_5m_input_tokens;
    const ephemeral1h = merged.cache_creation?.ephemeral_1h_input_tokens;
    return [
      {
        type: "usage",
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          cacheReadTokens,
          cacheWriteTokens: cacheWriteTokensRaw ?? undefined,
          cacheWriteTokensRaw: cacheWriteTokensRaw ?? null,
          cacheCreationEphemeral5mTokens: ephemeral5m,
          cacheCreationEphemeral1hTokens: ephemeral1h,
          rawUsage: merged,
          endpoint,
        },
      },
    ];
  }

  // message_stop / content_block_start / content_block_stop / ping：忽略，
  // message_stop 由外层统一发出，避免重复。
  return [];
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
      name: toolCall.function?.name || existing.name,
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

function sanitizeProviderBadRequestHint(responseText?: string): string | undefined {
  if (!responseText) {
    return undefined;
  }
  const compact = responseText
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) {
    return undefined;
  }
  const lower = compact.toLowerCase();
  if (lower.includes("tool_choice") || lower.includes("tools")) {
    return "provider rejected tools/tool_choice fields";
  }
  if (lower.includes("reasoning") || lower.includes("thinking")) {
    return "provider rejected reasoning/thinking fields";
  }
  if (lower.includes("message") || lower.includes("tool_call") || lower.includes("tool result")) {
    return "provider rejected message/tool_result schema";
  }
  if (lower.includes("model")) {
    return "provider rejected model/profile combination";
  }
  return "provider rejected request body; check schema/profile/model";
}

function createHttpStatusError(
  status: number,
  responseText?: string,
  providerType?: ProviderConfig["type"],
): LinghunError {
  if (status === 400) {
    const hint = sanitizeProviderBadRequestHint(responseText);
    return new LinghunError({
      code: "PROVIDER_BAD_REQUEST",
      message: `模型请求失败：HTTP 400，请求格式不被 provider 接受${hint ? `（${hint}）` : "。"}`,
      suggestion:
        "请运行 /model doctor；重点检查 endpointProfile、compatibilityProfile、model、tools/tool_choice 支持、reasoning/thinking 字段、tool_result 回灌格式和 OpenAI-compatible 网关兼容性。",
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
        providerType === "openai-compatible"
          ? "请稍后重试；如持续失败，运行 /model doctor 检查 provider/baseUrl/model、endpointProfile 是否被网关支持，以及 base_url 是否误填了完整 endpoint。"
          : "请稍后重试；如持续失败，运行 /model doctor 检查 base_url 或切换 fallback model。",
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
