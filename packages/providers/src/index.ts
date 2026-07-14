import { createHash } from "node:crypto";
import { LinghunError } from "@linghun/core";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  LINGHUN_CLI_NAME,
  LINGHUN_NAME,
  LINGHUN_VERSION,
  formatDiagnosticError,
  normalizeDeepSeekModelName,
  readPositiveIntEnv,
} from "@linghun/shared";
import {
  getRegisteredClientFactories,
  registerClientFactories,
} from "./provider-client-runtime.js";
export { registerClientFactories } from "./provider-client-runtime.js";

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheWriteTokensEstimated?: boolean;
  // D.13F：Anthropic prompt cache 显式 cache_control 时，message_start/message_delta 的
  // usage.cache_creation 会带上 ephemeral_5m_input_tokens / ephemeral_1h_input_tokens；
  // 仅作只读统计使用，OpenAI 兼容路径不会写这两个字段。
  cacheCreationEphemeral5mTokens?: number;
  cacheCreationEphemeral1hTokens?: number;
  rawUsage?: unknown;
  endpoint?: string;
};

export type ModelToolDefinitionSource = "built-in" | "mcp" | "skill" | "plugin" | "unknown";

export type ModelToolDefinition = {
  name: string;
  description: string;
  inputSchema: unknown;
  source?: ModelToolDefinitionSource;
  schemaHash?: string;
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
  | "anthropic_messages"
  | "gemini"
  | "grok";
export type ProviderRuntimeProfile =
  | "deepseek_chat_completions"
  | "deepseek_anthropic_messages"
  | "strict_openai_compatible_chat_completions"
  | "permissive_openai_compatible_chat_completions"
  | "openai_responses"
  | "anthropic_messages"
  | "gemini_chat_completions"
  | "grok_responses";

export type ProviderReasoningTransport =
  | "openai-reasoning-effort"
  | "anthropic-thinking-budget"
  | "model-controlled"
  | "not-sent";

export type ProviderConfig = {
  id: string;
  type: "openai-compatible" | "deepseek" | "gemini" | "grok";
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
  // D.13H：Anthropic Context Editing / cache_edits 收口（hard-disabled）。
  // 默认 contextEditingEnabled=false，anthropicBetaHeaders=[]。仅在
  //   contextEditingEnabled === true
  //   AND endpointProfile === "anthropic_messages"
  //   AND anthropicBetaHeaders.filter(Boolean).length > 0
  // 三者同时成立时才会在请求 headers 上追加 anthropic-beta；
  // 即使 enabled=true，请求 body 永不写入 cache_edits / cache_reference
  // （CCB 上游 CACHE_EDITING_BETA_HEADER 仍是空字符串，写入会触发 Anthropic 400）。
  // OpenAI chat / responses 路径硬隔离，永不输出这些字段。
  contextEditingEnabled?: boolean;
  anthropicBetaHeaders?: string[];
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

const PROVIDER_SSE_BUFFER_LIMIT_CHARS = 1_000_000;
const PROVIDER_SSE_EVENT_LIMIT_CHARS = 1_000_000;
const PROVIDER_TOOL_ARGUMENTS_LIMIT_CHARS = 1_000_000;

function createProviderStreamLimitError(
  scope: "SSE buffer" | "SSE event" | "tool arguments",
  endpoint: string,
  limit: number,
): LinghunEvent {
  return {
    type: "error",
    error: new LinghunError({
      code: "PROVIDER_STREAM_LIMIT_EXCEEDED",
      message: `模型请求失败：provider ${scope} 超过安全上限 ${limit} chars。`,
      suggestion: `请重试；如持续出现，运行 /model doctor 检查 ${endpoint} 的流式兼容性，或切换 provider/model。`,
      recoverable: true,
    }),
  };
}

export type ModelMessagePromptCacheHint = "cacheable" | "volatile";

export type ModelMessage =
  | {
      role: "system" | "user";
      content: string;
      /** Internal cache-boundary hint. Provider builders must not serialize this field directly. */
      promptCache?: ModelMessagePromptCacheHint;
    }
  | { role: "assistant"; content: string; toolCalls?: ModelToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type ModelRequest = {
  messages: ModelMessage[];
  model?: string;
  maxOutputTokens?: number;
  tools?: ModelToolDefinition[];
  toolChoice?: "auto" | "none";
  parallelToolCalls?: boolean;
  endpointProfile?: EndpointProfile;
  reasoningLevel?: string;
  // D.13F：prompt cache 输入。enabled 默认由上层（TUI/runtime）解析后注入；
  // promptCacheTtl 只支持 "1h" 显式传，不传等于 5m 默认（cache_control 不写 ttl 字面量）。
  // cacheBreakNonce 由 TUI/runtime 根据 once/always 标记文件计算后注入；provider 不读不写文件。
  promptCacheEnabled?: boolean;
  promptCacheTtl?: "1h";
  cacheBreakNonce?: string;
  promptCacheKey?: string;
  /** Request context for retry differentiation. "foreground" = user waiting (default); "agent" = sub-agent. */
  requestContext?: "foreground" | "agent";
  /** Process-local owner for retry hooks; prevents one TUI context from observing another context's retries. */
  requestContextId?: string;
  /** Logical session owner for diagnostics and retry hook scoping. */
  sessionId?: string;
};

export type TokenCountResult =
  | { source: "api"; inputTokens: number; outputTokens?: number; raw?: unknown }
  | { source: "unavailable"; reason: string };

export type ToolMessagePairingIssue =
  | "missing_tool_result"
  | "orphan_tool_result"
  | "duplicate_tool_result"
  | "duplicate_tool_call_id"
  | "invalid_tool_call_id"
  | "invalid_tool_result_id";

export type ToolMessagePairingRepair = {
  messages: ModelMessage[];
  issues: ToolMessagePairingIssue[];
};

export type Provider = {
  id: string;
  displayName: string;
  supports: ProviderCapabilities;
  listModels(): Promise<ModelInfo[]>;
  countTokens?(request: ModelRequest, signal?: AbortSignal): Promise<TokenCountResult>;
  stream(
    request: ModelRequest,
    signal?: AbortSignal,
    control?: ProviderStreamControl,
  ): AsyncGenerator<LinghunEvent>;
};

export type ProviderStreamControl = {
  onAttemptReset?: (info: {
    reason: "same_provider_retry" | "stream_incomplete" | "stream_http_error";
    replacement: "same_provider_stream" | "non_streaming_fallback";
  }) => void;
};

export type OpenAiChatRequest = {
  model: string;
  messages: OpenAiChatMessage[];
  stream: true;
  max_tokens?: number;
  tools?: Array<OpenAiToolDefinition | OpenAiChatWebSearchToolDefinition>;
  tool_choice?: "auto" | "none";
  parallel_tool_calls?: boolean;
  reasoning?: { effort: string };
  stream_options?: { include_usage: true };
  web_search_options?: Record<string, never>;
};

export type OpenAiResponsesRequest = {
  model: string;
  input: OpenAiResponsesInputItem[];
  stream: true;
  prompt_cache_key?: string;
  max_output_tokens?: number;
  tools?: OpenAiResponsesToolDefinition[];
  tool_choice?: "auto" | "none";
  parallel_tool_calls?: boolean;
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

type OpenAiChatWebSearchToolDefinition = {
  type: "web_search_preview";
};

type OpenAiResponsesFunctionToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: unknown;
};

type OpenAiResponsesWebSearchToolDefinition = {
  type: "web_search";
  external_web_access?: boolean;
};

type OpenAiResponsesToolDefinition =
  | OpenAiResponsesFunctionToolDefinition
  | OpenAiResponsesWebSearchToolDefinition;

type PendingResponsesToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type CachedAnthropicToolBase = Omit<AnthropicToolDefinition, "cache_control">;
type CachedOpenAiChatToolBase = OpenAiToolDefinition;
type CachedOpenAiResponsesToolBase = OpenAiResponsesToolDefinition;

const TOOL_SCHEMA_BASE_CACHE_LIMIT = 256;
const toolSchemaBaseCache = new Map<string, unknown>();

// ---------------------------------------------------------------------------
// Anthropic Messages (/v1/messages) — request / stream event shapes
// ---------------------------------------------------------------------------
// D.13G：anthropic_messages profile 现在原生支持 tools（tool_use / tool_result /
// input_json_delta 路径全部启用）。message content 既支持 string 形态也支持
// content block array 形态（block 形态承载 tool_use 与 tool_result）。
// D.13F：system 字段支持 string 与 block-array 两种形态，block 形态用于挂 cache_control。
// 默认 5m：cache_control 只传 { type: "ephemeral" }，不传 ttl: "5m" 字面量。
// 1h 仅在用户显式 promptCache.systemTtl="1h" 时设 ttl: "1h"，不附加 beta header。
export type AnthropicTextBlock = {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
};

export type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  cache_control?: AnthropicCacheControl;
};

export type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  cache_control?: AnthropicCacheControl;
};

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

type AnthropicMessage =
  | { role: "user"; content: string | AnthropicContentBlock[] }
  | { role: "assistant"; content: string | AnthropicContentBlock[] };

export type AnthropicCacheControl = { type: "ephemeral"; ttl?: "1h" };

export type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
};

export type AnthropicToolDefinition = {
  type?: "web_search_20250305";
  name: string;
  description?: string;
  input_schema?: unknown;
  max_uses?: number;
  cache_control?: AnthropicCacheControl;
};

export type AnthropicToolChoice =
  | { type: "auto"; disable_parallel_tool_use?: boolean }
  | { type: "any"; disable_parallel_tool_use?: boolean }
  | { type: "none" }
  | { type: "tool"; name: string; disable_parallel_tool_use?: boolean };

// Anthropic Messages API extended thinking 配置；budget_tokens 为 thinking 上限。
// 仅在 Linghun reasoningLevel 非空且 endpointProfile=anthropic_messages 时由 builder 注入。
export type AnthropicThinkingConfig = { type: "enabled"; budget_tokens: number };

export type AnthropicMessagesRequest = {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  stream: true;
  system?: string | AnthropicSystemBlock[];
  tools?: AnthropicToolDefinition[];
  tool_choice?: AnthropicToolChoice;
  thinking?: AnthropicThinkingConfig;
};

type AnthropicStreamEvent =
  | { type: "message_start"; message?: { id?: string; usage?: AnthropicUsage } }
  | {
      type: "content_block_start";
      index?: number;
      content_block?: {
        type?: string;
        id?: string;
        name?: string;
        input?: unknown;
        text?: string;
      };
    }
  | {
      type: "content_block_delta";
      index?: number;
      delta?: {
        type?: string;
        text?: string;
        partial_json?: string;
        // D.13M：extended thinking 流。thinking_delta 携带 thinking 文本；
        // signature_delta / redacted_thinking 不暴露 signature/data 给 Linghun 主屏。
        thinking?: string;
      };
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
  // 有些 Anthropic-compatible gateways only expose these split fields; we fold them into
  // cacheWriteTokens while preserving the split values for diagnostics.
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
};

export type ProviderRuntimeContract = {
  profile: ProviderRuntimeProfile;
  endpointProfile: EndpointProfile;
  endpoint: "/chat/completions" | "/responses" | "/v1/messages" | "/anthropic/v1/messages";
  compatibilityProfile: ProviderCompatibilityProfile;
  supportsTools: boolean;
  sendReasoning: boolean;
  reasoningTransport: ProviderReasoningTransport;
  unsupportedReasoningLevel?: string;
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
const PROVIDER_MAX_ATTEMPTS = 10;

const PROVIDER_STREAM_IDLE_TIMEOUT_MS = readPositiveIntEnv(
  "LINGHUN_PROVIDER_STREAM_IDLE_TIMEOUT_MS",
  60_000,
);
const PROVIDER_REQUEST_TIMEOUT_MS = readPositiveIntEnv("LINGHUN_PROVIDER_TIMEOUT_MS", 120_000);
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
    id: "deepseek-chat",
    displayName: "DeepSeek Chat",
    providerId: "deepseek",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    supportsPromptCache: false,
  },
  {
    id: "deepseek-reasoner",
    displayName: "DeepSeek Reasoner",
    providerId: "deepseek",
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    supportsPromptCache: false,
  },
];

export function findKnownModel(modelId: string): ModelInfo | undefined {
  const normalized = normalizeDeepSeekModelName(modelId);
  return deepSeekModels.find((model) => model.id === normalized);
}

export class ModelGateway {
  constructor(private readonly providers: Provider[]) {}

  async currentModel(providerId: string, modelId: string): Promise<ModelInfo> {
    const provider = this.findProvider(providerId);
    const models = await provider.listModels();
    const normalizedModelId = normalizeDeepSeekModelName(modelId);
    const model = models.find((item) => item.id === normalizedModelId);
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
    control?: ProviderStreamControl,
  ): AsyncGenerator<LinghunEvent> {
    const provider = this.findProvider(providerId);
    try {
      const safeRequest = await this.withSupportedTools(provider, request);
      // 注：空响应识别（chunkCount=0 / 无文本 / 仅 usage）由 model-loop 一侧基于
      // message_stop 与累计的 assistantText 判定，并走现存的中文友好降级文案，
      // 详见 tui/src/index.ts streamFinalModelAnswerWithoutTools 与
      // recordProviderEmptyResponse / formatProviderEmptyResponsePrimary。
      // 此处不在 gateway 再 yield PROVIDER_EMPTY_RESPONSE error 事件，避免覆盖现存路径。
      yield* provider.stream(safeRequest, signal, control);
    } catch (error) {
      const linghunError = signal.aborted
        ? createProviderAbortError(error)
        : normalizeProviderError(error);
      yield { type: "error", error: linghunError };
    }
  }

  async countMessagesTokensWithAPI(
    providerId: string,
    request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<TokenCountResult> {
    const provider = this.findProvider(providerId);
    if (!provider.countTokens) {
      return { source: "unavailable", reason: "provider_count_tokens_not_supported" };
    }
    return provider.countTokens(request, signal);
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
  } else if (normalizedBaseUrl.endsWith("/anthropic/v1/messages")) {
    normalizedBaseUrl = normalizedBaseUrl.slice(0, -"/anthropic/v1/messages".length);
    fullEndpointSuffix = "anthropic_messages";
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

// D.13H：Anthropic Context Editing / cache_edits 诊断（hard-disabled 收口）。
// 仅在 endpointProfile === "anthropic_messages"、contextEditingEnabled === true、
// 且 anthropicBetaHeaders 至少包含一个非空字符串时，sendable=true，stream() 才会
// 在请求 headers 上追加 anthropic-beta：<headers.join(",")>。
// 即使 sendable=true，请求 body 仍然永远不写入 cache_edits / cache_reference —— CCB
// 上游 CACHE_EDITING_BETA_HEADER 仍是空字符串，写入会触发 Anthropic 400
//   tool_result.cache_reference: Extra inputs are not permitted
// 不输出 raw beta header 字符串、不输出 apiKey、不输出 prompt；仅输出 count + 原因。
export type AnthropicContextEditingDiagnostic = {
  enabled: boolean;
  sendable: boolean;
  betaHeaderCount: number;
  disabledReason: string | null;
};

export function resolveAnthropicContextEditingDiagnostic(
  config: Pick<ProviderConfig, "contextEditingEnabled" | "anthropicBetaHeaders">,
  contract: Pick<ProviderRuntimeContract, "endpointProfile">,
): AnthropicContextEditingDiagnostic {
  const enabled = config.contextEditingEnabled === true;
  const headers = (config.anthropicBetaHeaders ?? []).filter(
    (header) => typeof header === "string" && header.length > 0,
  );
  const betaHeaderCount = headers.length;
  if (contract.endpointProfile !== "anthropic_messages") {
    return {
      enabled,
      sendable: false,
      betaHeaderCount,
      disabledReason:
        "unsupported endpoint profile (chat_completions / responses 不支持 cache_edits)",
    };
  }
  if (!enabled) {
    return {
      enabled: false,
      sendable: false,
      betaHeaderCount,
      disabledReason: "disabled by config",
    };
  }
  if (betaHeaderCount === 0) {
    return {
      enabled: true,
      sendable: false,
      betaHeaderCount: 0,
      disabledReason: "missing non-empty beta header",
    };
  }
  return {
    enabled: true,
    sendable: true,
    betaHeaderCount,
    disabledReason: null,
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
        contextWindow: 200_000,
        maxOutputTokens: this.config.maxOutputTokens ?? 4_096,
        supportsTools: this.config.supportsTools ?? true,
        supportsVision: false,
        supportsThinking: false,
        supportsPromptCache: false,
      },
    ];
  }

  createChatRequest(request: ModelRequest): OpenAiChatRequest {
    return getRegisteredClientFactories().chat({
      config: this.config,
      request,
      contract: resolveProviderRuntimeContract(this.config, request),
    });
  }

  createResponsesRequest(request: ModelRequest): OpenAiResponsesRequest {
    return getRegisteredClientFactories().responses({
      config: this.config,
      request,
      contract: resolveProviderRuntimeContract(this.config, request),
    });
  }

  createAnthropicMessagesRequest(request: ModelRequest): AnthropicMessagesRequest {
    return getRegisteredClientFactories().anthropicMessages({
      config: this.config,
      request,
      contract: resolveProviderRuntimeContract(this.config, request),
    });
  }

  async *stream(
    request: ModelRequest,
    signal?: AbortSignal,
    control?: ProviderStreamControl,
  ): AsyncGenerator<LinghunEvent> {
    this.assertReady();
    const requestController = new AbortController();
    const forwardAbort = () => requestController.abort(signal?.reason);
    if (signal?.aborted) {
      forwardAbort();
    } else {
      signal?.addEventListener("abort", forwardAbort, { once: true });
    }
    try {
      const requestSignal = requestController.signal;
      const contract = resolveProviderRuntimeContract(this.config, request);
      const baseUrlDiagnostic = resolveProviderBaseUrlDiagnostic(
        this.config.baseUrl,
        contract.endpointProfile,
      );
      const url = joinBaseUrlAndEndpoint(baseUrlDiagnostic.normalizedBaseUrl, contract.endpoint);
      if (contract.endpointProfile === "anthropic_messages") {
        const body = getRegisteredClientFactories().anthropicMessages({
          config: this.config,
          request,
          contract,
        });
        // D.13H：Anthropic Context Editing / cache_edits 收口。仅在
        //   contextEditingEnabled === true
        //   AND endpointProfile === "anthropic_messages"
        //   AND anthropicBetaHeaders.filter(Boolean).length > 0
        // 三者同时成立时，才把 anthropic-beta: <headers.join(",")> 附加进 headers；
        // 永不发空的 anthropic-beta header（即使长度 1 但全空字符串也按 0 处理）。
        // 即使 sendable=true，请求 body 仍然由 createAnthropicMessagesProfileRequest
        // 硬禁止 cache_edits / cache_reference 字段（hard-disabled）。
        const contextEditing = resolveAnthropicContextEditingDiagnostic(this.config, contract);
        const headers: Record<string, string> = {
          "content-type": "application/json",
          ...LINGHUN_REQUEST_IDENTITY_HEADERS,
          // Anthropic Messages 鉴权头：x-api-key + anthropic-version。
          // 部分中转网关沿用 OpenAI 风格 Authorization: Bearer，因此并发发送两套头，
          // Anthropic 官方接口忽略 Authorization，OpenAI 风格中转忽略 x-api-key/version。
          "x-api-key": this.config.apiKey ?? "",
          "anthropic-version": "2023-06-01",
          authorization: `Bearer ${this.config.apiKey ?? ""}`,
          accept: "text/event-stream",
        };
        if (contextEditing.sendable) {
          const filteredBetaHeaders = (this.config.anthropicBetaHeaders ?? []).filter(
            (header) => typeof header === "string" && header.length > 0,
          );
          if (filteredBetaHeaders.length > 0) {
            headers["anthropic-beta"] = filteredBetaHeaders.join(",");
          }
        }
        const response = await fetchWithProviderRetry(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: requestSignal,
        });

        if (!response.ok) {
          const responseText = await safeReadResponseText(response);
          const fallback = await tryNonStreamingFallback({
            providerConfig: this.config,
            request,
            contract,
            baseUrl: baseUrlDiagnostic.normalizedBaseUrl,
            status: response.status,
            responseText,
            requestSignal,
          });
          if (fallback) {
            control?.onAttemptReset?.({
              reason: "stream_http_error",
              replacement: "non_streaming_fallback",
            });
            yield* fallback;
            return;
          }
          if (response.status === 401 || response.status === 403) {
            throw createApiKeyError(response.status, undefined, {
              endpointProfile: contract.endpointProfile,
              endpoint: contract.endpoint,
              responseText,
            });
          }
          throw createHttpStatusError(response.status, responseText, this.config.type, {
            endpointProfile: contract.endpointProfile,
            endpoint: contract.endpoint,
          });
        }

        if (!response.body) {
          throw new LinghunError({
            code: "PROVIDER_STREAM_EMPTY",
            message: "模型请求失败：响应中没有可读取的流。",
            suggestion: `请确认 base_url 支持 ${contract.profile} 的 ${contract.endpoint} 流式接口。`,
            recoverable: true,
          });
        }

        await assertSseContentType(response, contract.endpointProfile, contract.endpoint);

        let yieldedToolUse = false;
        for await (const event of parseAnthropicMessagesStream(
          withStreamIdleTimeout(
            response.body,
            PROVIDER_STREAM_IDLE_TIMEOUT_MS,
            requestSignal,
            requestController,
          ),
          contract.endpoint,
        )) {
          if (event.type === "tool_use") yieldedToolUse = true;
          if (!yieldedToolUse && isProviderIncompleteStreamErrorEvent(event)) {
            const fallback = await tryNonStreamingFallback({
              providerConfig: this.config,
              request,
              contract,
              baseUrl: baseUrlDiagnostic.normalizedBaseUrl,
              requestSignal,
            });
            if (fallback) {
              control?.onAttemptReset?.({
                reason: "stream_incomplete",
                replacement: "non_streaming_fallback",
              });
              yield* fallback;
              return;
            }
          }
          yield event;
        }
        return;
      }

      const body =
        contract.endpointProfile === "responses"
          ? getRegisteredClientFactories().responses({ config: this.config, request, contract })
          : getRegisteredClientFactories().chat({ config: this.config, request, contract });
      const response = await fetchWithProviderRetry(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...LINGHUN_REQUEST_IDENTITY_HEADERS,
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: requestSignal,
      });

      if (!response.ok) {
        const responseText = await safeReadResponseText(response);
        const fallback = await tryNonStreamingFallback({
          providerConfig: this.config,
          request,
          contract,
          baseUrl: baseUrlDiagnostic.normalizedBaseUrl,
          status: response.status,
          responseText,
          requestSignal,
        });
        if (fallback) {
          control?.onAttemptReset?.({
            reason: "stream_http_error",
            replacement: "non_streaming_fallback",
          });
          yield* fallback;
          return;
        }
        if (response.status === 401 || response.status === 403) {
          throw createApiKeyError(response.status, undefined, {
            endpointProfile: contract.endpointProfile,
            endpoint: contract.endpoint,
            responseText,
          });
        }
        throw createHttpStatusError(response.status, responseText, this.config.type, {
          endpointProfile: contract.endpointProfile,
          endpoint: contract.endpoint,
        });
      }

      if (!response.body) {
        throw new LinghunError({
          code: "PROVIDER_STREAM_EMPTY",
          message: "模型请求失败：响应中没有可读取的流。",
          suggestion: `请确认 base_url 支持 ${contract.profile} 的 ${contract.endpoint} 流式接口。`,
          recoverable: true,
        });
      }

      await assertSseContentType(response, contract.endpointProfile, contract.endpoint);

      let yieldedToolUse = false;
      for await (const event of parseOpenAiStream(
        withStreamIdleTimeout(
          response.body,
          PROVIDER_STREAM_IDLE_TIMEOUT_MS,
          requestSignal,
          requestController,
        ),
        contract.endpointProfile === "responses" ? "/v1/responses" : "/v1/chat/completions",
      )) {
        if (event.type === "tool_use") yieldedToolUse = true;
        if (!yieldedToolUse && isProviderIncompleteStreamErrorEvent(event)) {
          const fallback = await tryNonStreamingFallback({
            providerConfig: this.config,
            request,
            contract,
            baseUrl: baseUrlDiagnostic.normalizedBaseUrl,
            requestSignal,
          });
          if (fallback) {
            control?.onAttemptReset?.({
              reason: "stream_incomplete",
              replacement: "non_streaming_fallback",
            });
            yield* fallback;
            return;
          }
        }
        yield event;
      }
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
    }
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

type ProviderReasoningCapability = Pick<
  ProviderRuntimeContract,
  "sendReasoning" | "reasoningTransport" | "unsupportedReasoningLevel"
>;

function resolveSendableReasoning(
  level: string | undefined,
  transport: Exclude<ProviderReasoningTransport, "model-controlled" | "not-sent">,
  supportedLevels: readonly string[],
): ProviderReasoningCapability {
  if (!level) {
    return { sendReasoning: false, reasoningTransport: "not-sent" };
  }
  const normalized = level.trim().toLowerCase();
  if (supportedLevels.includes(normalized)) {
    return { sendReasoning: true, reasoningTransport: transport };
  }
  return {
    sendReasoning: false,
    reasoningTransport: "not-sent",
    unsupportedReasoningLevel: level,
  };
}

export function resolveProviderRuntimeContract(
  config: ProviderConfig,
  request: ModelRequest = { messages: [] },
): ProviderRuntimeContract {
  const supportsTools = config.supportsTools !== false;
  const reasoningLevel = request.reasoningLevel ?? config.reasoningLevel;
  if (config.type === "gemini") {
    const reasoning = resolveSendableReasoning(
      reasoningLevel,
      "openai-reasoning-effort",
      ["low", "medium", "high"],
    );
    return {
      profile: "gemini_chat_completions",
      endpointProfile: "chat_completions",
      endpoint: "/chat/completions",
      compatibilityProfile: "gemini",
      supportsTools,
      ...reasoning,
      includeUsage: true,
      toolSchemaShape: supportsTools ? "openai_chat_tools" : "tools_disabled",
      toolResultShape: supportsTools ? "chat_tool_message" : "tools_disabled",
      retryStatuses: [...PROVIDER_RETRY_STATUSES],
      maxAttempts: PROVIDER_MAX_ATTEMPTS,
      requestTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      streamIdleTimeoutMs: PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    };
  }
  if (config.type === "grok") {
    return {
      profile: "grok_responses",
      endpointProfile: "responses",
      endpoint: "/responses",
      compatibilityProfile: "grok",
      supportsTools,
      sendReasoning: false,
      reasoningTransport: "model-controlled",
      includeUsage: true,
      toolSchemaShape: supportsTools ? "openai_responses_tools" : "tools_disabled",
      toolResultShape: supportsTools ? "responses_function_call_output" : "tools_disabled",
      retryStatuses: [...PROVIDER_RETRY_STATUSES],
      maxAttempts: PROVIDER_MAX_ATTEMPTS,
      requestTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      streamIdleTimeoutMs: PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    };
  }
  if (config.type === "deepseek") {
    const endpointProfile =
      request.endpointProfile === "anthropic_messages" ||
      config.endpointProfile === "anthropic_messages" ||
      inferEndpointProfileFromBaseUrl(config.baseUrl) === "anthropic_messages"
        ? "anthropic_messages"
        : "chat_completions";
    if (endpointProfile === "anthropic_messages") {
      return {
        profile: "deepseek_anthropic_messages",
        endpointProfile,
        endpoint: "/anthropic/v1/messages",
        compatibilityProfile: "anthropic_messages",
        supportsTools,
        sendReasoning: false,
        reasoningTransport: "model-controlled",
        includeUsage: false,
        toolSchemaShape: supportsTools ? "anthropic_tools" : "tools_disabled",
        toolResultShape: supportsTools ? "anthropic_tool_result" : "tools_disabled",
        retryStatuses: [...PROVIDER_RETRY_STATUSES],
        maxAttempts: PROVIDER_MAX_ATTEMPTS,
        requestTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
        streamIdleTimeoutMs: PROVIDER_STREAM_IDLE_TIMEOUT_MS,
      };
    }
    return {
      profile: "deepseek_chat_completions",
      endpointProfile: "chat_completions",
      endpoint: "/chat/completions",
      compatibilityProfile: "deepseek",
      supportsTools,
      sendReasoning: false,
      reasoningTransport: "model-controlled",
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
    const reasoning = resolveSendableReasoning(
      reasoningLevel,
      "anthropic-thinking-budget",
      ["low", "medium", "high"],
    );
    // D.13G：anthropic_messages profile 现在原生支持 tools/tool calling。
    // 默认 supportsTools=true（与 OpenAI 路径行为一致），仅当用户显式
    // config.supportsTools=false 时才禁用；toolSchemaShape="anthropic_tools"
    // 走 Anthropic 原生 schema（{name, description, input_schema}），
    // toolResultShape="anthropic_tool_result" 走 user content block 形态。
    // D.13K：Anthropic Messages 原生支持 extended thinking。仅 Low/Medium/High
    // 会由 body builder 注入 thinking 字段（不复用 OpenAI reasoning.effort）。
    return {
      profile: "anthropic_messages",
      endpointProfile,
      endpoint: "/v1/messages",
      compatibilityProfile,
      supportsTools,
      ...reasoning,
      includeUsage: false,
      toolSchemaShape: supportsTools ? "anthropic_tools" : "tools_disabled",
      toolResultShape: supportsTools ? "anthropic_tool_result" : "tools_disabled",
      retryStatuses: [...PROVIDER_RETRY_STATUSES],
      maxAttempts: PROVIDER_MAX_ATTEMPTS,
      requestTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      streamIdleTimeoutMs: PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    };
  }
  if (endpointProfile === "responses") {
    const reasoning = resolveSendableReasoning(
      reasoningLevel,
      "openai-reasoning-effort",
      ["low", "medium", "high", "xhigh", "max"],
    );
    return {
      profile: "openai_responses",
      endpointProfile,
      endpoint: "/responses",
      compatibilityProfile,
      supportsTools,
      ...reasoning,
      includeUsage: config.includeUsage === true,
      toolSchemaShape: "openai_responses_tools",
      toolResultShape: "responses_function_call_output",
      retryStatuses: [...PROVIDER_RETRY_STATUSES],
      maxAttempts: PROVIDER_MAX_ATTEMPTS,
      requestTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      streamIdleTimeoutMs: PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    };
  }
  const reasoning =
    compatibilityProfile === "permissive_openai_compatible"
      ? resolveSendableReasoning(reasoningLevel, "openai-reasoning-effort", [
          "low",
          "medium",
          "high",
          "max",
        ])
      : ({ sendReasoning: false, reasoningTransport: "not-sent" } as const);
  return {
    profile:
      compatibilityProfile === "permissive_openai_compatible"
        ? "permissive_openai_compatible_chat_completions"
        : "strict_openai_compatible_chat_completions",
    endpointProfile: "chat_completions",
    endpoint: "/chat/completions",
    compatibilityProfile,
    supportsTools,
    ...reasoning,
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

const CLAUDE_MODEL_PATTERN = /^claude[-_](?:3|4|5|opus|sonnet|haiku)/i;

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

  // 1. request 级 override：
  //    - anthropic_messages / responses 保持最高优先（per-request 显式声明应当生效）；
  //    - chat_completions 在 Claude 模型上一律视为占位（无论 config 是空 / chat_completions /
  //      anthropic_messages / responses），不阻断后续 baseUrl/config/auto-claude 决策：
  //      TUI 旧 SelectedModelRuntime narrow 为 chat_completions | responses，会把
  //      "chat_completions" 默认值带进 request；如果这里信任 request.chat_completions，
  //      即使 config.endpointProfile=anthropic_messages，Claude 真实路径仍会被 placeholder
  //      带偏到 OpenAI chat。
  //    - 其它 request.chat_completions（非 Claude）仍按显式声明生效。
  const requestProfile = input.requestEndpointProfile;
  if (requestProfile === "anthropic_messages" || requestProfile === "responses") {
    if (baseUrlSuffix && baseUrlSuffix !== requestProfile) {
      warnings.push(
        `request endpointProfile=${requestProfile} 与 baseUrl suffix=${baseUrlSuffix} 不一致；以 request 为准`,
      );
    }
    return {
      endpointProfile: requestProfile,
      source: "request",
      reason: "request 显式声明 endpointProfile",
      warnings,
    };
  }
  const requestIsChatPlaceholderForClaude =
    requestProfile === "chat_completions" && modelLooksClaude;
  if (requestProfile === "chat_completions" && !requestIsChatPlaceholderForClaude) {
    if (baseUrlSuffix && baseUrlSuffix !== requestProfile) {
      warnings.push(
        `request endpointProfile=${requestProfile} 与 baseUrl suffix=${baseUrlSuffix} 不一致；以 request 为准`,
      );
    }
    return {
      endpointProfile: requestProfile,
      source: "request",
      reason: "request 显式声明 endpointProfile",
      warnings,
    };
  }
  // requestProfile === "chat_completions" 且 Claude placeholder：继续走 baseUrl / auto-claude
  // 决策；不在这里直接生效，避免被 TUI selectedRuntime placeholder 带偏到 OpenAI chat。

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
  if (trimmed.endsWith("/anthropic/v1/messages")) return "anthropic_messages";
  if (trimmed.endsWith("/v1/messages")) return "anthropic_messages";
  if (trimmed.endsWith("/chat/completions")) return "chat_completions";
  if (trimmed.endsWith("/responses")) return "responses";
  return undefined;
}

/**
 * Single-attempt HTTP fetch with request timeout.
 * Retry decisions are made by the main chain (model-stream-runtime.ts)
 * so that every retry is visible to the circuit breaker and concurrency gate.
 */
async function fetchWithProviderRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetchWithRequestTimeout(url, init, PROVIDER_REQUEST_TIMEOUT_MS);
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(resolvePromise, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          rejectPromise(signal.reason ?? new Error("Aborted"));
        },
        { once: true },
      );
    }
  });
}

async function safeReadResponseText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch (error) {
    process.stderr.write(
      `[linghun] provider_response_text_read_failed status=${response.status} reason=${formatDiagnosticError(error)}\n`,
    );
    return undefined;
  }
}

const NON_SSE_BODY_PREVIEW_LIMIT = 480;

function summarizeNonSseBodyForError(body: string | undefined): string {
  if (!body) return "<空响应体>";
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (!collapsed) return "<空响应体>";
  // 去除可能出现的密钥碎片（sk- / Bearer ...），避免错误信息把 token 回显出去。
  const redacted = collapsed
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{6,}/gi, "Bearer ***");
  if (redacted.length <= NON_SSE_BODY_PREVIEW_LIMIT) return redacted;
  return `${redacted.slice(0, NON_SSE_BODY_PREVIEW_LIMIT)}…`;
}

async function assertSseContentType(
  response: Response,
  endpointProfile: EndpointProfile,
  endpoint: string,
): Promise<void> {
  const rawContentType = response.headers.get("content-type") ?? "";
  const lower = rawContentType.toLowerCase();
  // 兼容 `text/event-stream`、`application/event-stream`、带 charset 后缀，
  // 以及部分网关写成 `event-stream` 的情况。
  if (lower.includes("event-stream")) return;

  const bodyText = await safeReadResponseText(response);
  const preview = summarizeNonSseBodyForError(bodyText);
  const contentTypeLabel = rawContentType.trim() || "<未声明>";
  throw new LinghunError({
    code: "PROVIDER_NON_SSE_STREAM",
    message:
      `模型请求失败：endpointProfile=${endpointProfile}，endpoint=${endpoint}，` +
      `网关返回 200 但 content-type=${contentTypeLabel}，不是 SSE 流。响应体预览：${preview}`,
    suggestion:
      "请检查 base_url 是否指向了正确的流式端点（Anthropic Messages 应为 /v1/messages，OpenAI Chat 为 /chat/completions），" +
      "OpenAI-compatible root baseUrl + responses 可能可用；chat_completions 通常需要 /v1 root。" +
      "如果返回 text/html，baseUrl 可能填到了网页登录页或少了 /v1。" +
      "或运行 /model doctor 复查 provider 路由。",
    recoverable: true,
  });
}

async function tryNonStreamingFallback(input: {
  providerConfig: ProviderConfig;
  request: ModelRequest;
  contract: ProviderRuntimeContract;
  baseUrl: string;
  status?: number;
  responseText?: string;
  requestSignal: AbortSignal;
}): Promise<LinghunEvent[] | undefined> {
  if (!shouldAttemptNonStreamingFallback(input.request, input.status)) {
    return undefined;
  }
  const body = createNonStreamingFallbackBody(input.request, input.providerConfig, input.contract);
  const response = await fetchWithProviderRetry(
    joinBaseUrlAndEndpoint(input.baseUrl, input.contract.endpoint),
    {
      method: "POST",
      headers: createProviderRequestHeaders(input.providerConfig, input.contract),
      body: JSON.stringify(body),
      signal: input.requestSignal,
    },
  );
  if (!response.ok) {
    return undefined;
  }
  const parsed = await safeReadJson(response);
  const text = extractNonStreamingText(parsed, input.contract.endpointProfile);
  if (!text) {
    return undefined;
  }
  const usage = extractNonStreamingUsage(
    parsed,
    input.contract.endpointProfile,
    input.contract.endpoint,
  );
  return [
    { type: "assistant_text_delta", id: "non-streaming-fallback", text },
    ...(usage ? [{ type: "usage" as const, usage }] : []),
    {
      type: "message_stop",
      id: "non-streaming-fallback",
      finishReason: "non_streaming_fallback",
      chunkCount: 1,
      hadUsage: Boolean(usage),
    },
  ];
}

function shouldAttemptNonStreamingFallback(request: ModelRequest, status?: number): boolean {
  if (request.tools?.length || request.toolChoice === "auto") return false;
  return status === undefined || status === 400 || status === 408 || status >= 500;
}

function createProviderRequestHeaders(
  config: ProviderConfig,
  contract: ProviderRuntimeContract,
): Record<string, string> {
  if (contract.endpointProfile === "anthropic_messages") {
    return {
      "content-type": "application/json",
      ...LINGHUN_REQUEST_IDENTITY_HEADERS,
      "x-api-key": config.apiKey ?? "",
      "anthropic-version": "2023-06-01",
      authorization: `Bearer ${config.apiKey ?? ""}`,
    };
  }
  return {
    "content-type": "application/json",
    ...LINGHUN_REQUEST_IDENTITY_HEADERS,
    authorization: `Bearer ${config.apiKey}`,
  };
}

function createNonStreamingFallbackBody(
  request: ModelRequest,
  config: ProviderConfig,
  contract: ProviderRuntimeContract,
): unknown {
  if (contract.endpointProfile === "responses") {
    const body = createResponsesProfileRequest(request, config, contract);
    return { ...body, stream: false };
  }
  if (contract.endpointProfile === "anthropic_messages") {
    const body = createAnthropicMessagesProfileRequest(request, config, contract);
    return { ...body, stream: false };
  }
  const body = createChatProfileRequest(request, config, contract);
  return { ...body, stream: false, stream_options: undefined };
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function extractNonStreamingText(parsed: unknown, endpointProfile: EndpointProfile): string {
  if (!parsed || typeof parsed !== "object") return "";
  const obj = parsed as Record<string, unknown>;
  if (endpointProfile === "responses") {
    const outputText = obj.output_text;
    if (typeof outputText === "string") return outputText;
    const output = obj.output;
    if (Array.isArray(output)) {
      return output
        .flatMap((item) =>
          item && typeof item === "object" && Array.isArray((item as { content?: unknown }).content)
            ? (item as { content: unknown[] }).content
            : [],
        )
        .map((item) =>
          item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
            ? (item as { text: string }).text
            : "",
        )
        .join("");
    }
  }
  if (endpointProfile === "anthropic_messages") {
    const content = obj.content;
    if (Array.isArray(content)) {
      return content
        .map((item) =>
          item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
            ? (item as { text: string }).text
            : "",
        )
        .join("");
    }
  }
  const choices = obj.choices;
  if (Array.isArray(choices)) {
    return choices
      .map((choice) => {
        if (!choice || typeof choice !== "object") return "";
        const message = (choice as { message?: unknown }).message;
        if (!message || typeof message !== "object") return "";
        const content = (message as { content?: unknown }).content;
        return typeof content === "string" ? content : "";
      })
      .join("");
  }
  return "";
}

function withStreamIdleTimeout(
  body: ReadableStream<Uint8Array>,
  timeoutMs: number,
  signal: AbortSignal,
  requestController?: AbortController,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new LinghunError({
            code: "PROVIDER_STREAM_TIMEOUT",
            message: `模型请求失败：流式响应超过 ${timeoutMs}ms 没有新数据。`,
            suggestion: "请稍后重试，或运行 /model doctor 检查 provider/model、网络和网关稳定性。",
            recoverable: true,
          });
          void reader.cancel(error).catch(() => undefined);
          requestController?.abort(error);
          reject(error);
        }, timeoutMs);
      });
      const clearIdleTimeout = () => {
        if (timer) clearTimeout(timer);
      };
      signal.addEventListener("abort", clearIdleTimeout, { once: true });
      try {
        const result = await Promise.race([reader.read(), timeout]);
        if (result.done) {
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } finally {
        clearIdleTimeout();
        signal.removeEventListener("abort", clearIdleTimeout);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function normalizeProviderRequestModel(model: string, config: ProviderConfig): string {
  return config.type === "deepseek" ? normalizeDeepSeekModelName(model) : model;
}

function createChatProfileRequest(
  request: ModelRequest,
  config: ProviderConfig,
  contract: ProviderRuntimeContract,
): OpenAiChatRequest {
  if (contract.endpointProfile !== "chat_completions") {
    throw new LinghunError({
      code: "PROVIDER_PROFILE_MISMATCH",
      message: `Provider profile mismatch: chat request builder received ${contract.endpointProfile} profile.`,
      suggestion: "请检查 endpointProfile；chat_completions 与 responses schema 不能混用。",
      recoverable: true,
    });
  }
  assertReasoningCapability(contract);
  const model = normalizeProviderRequestModel(request.model ?? config.model, config);
  const tools = createOpenAiChatTools(request, contract);
  const repaired = repairToolMessagePairing(request.messages);
  return {
    model,
    messages: repaired.messages.map(toOpenAiMessage),
    stream: true,
    ...createOptionalMaxTokens("max_tokens", request, config),
    ...(tools && tools.length > 0
      ? {
          tools,
          tool_choice: request.toolChoice ?? "auto",
          ...(request.parallelToolCalls !== undefined
            ? { parallel_tool_calls: request.parallelToolCalls }
            : {}),
        }
      : request.toolChoice === "none"
        ? { tool_choice: "none" as const }
        : {}),
    ...(shouldAttachChatNativeWebSearch(request, config, contract)
      ? { web_search_options: {} }
      : {}),
    ...(contract.sendReasoning
      ? createReasoningPayload(request.reasoningLevel ?? config.reasoningLevel)
      : {}),
    ...(contract.includeUsage ? { stream_options: { include_usage: true as const } } : {}),
  };
}

function createResponsesProfileRequest(
  request: ModelRequest,
  config: ProviderConfig,
  contract: ProviderRuntimeContract,
): OpenAiResponsesRequest {
  if (contract.endpointProfile !== "responses") {
    throw new LinghunError({
      code: "PROVIDER_PROFILE_MISMATCH",
      message: `Provider profile mismatch: responses request builder received ${contract.endpointProfile} profile.`,
      suggestion: "请检查 endpointProfile；chat_completions 与 responses schema 不能混用。",
      recoverable: true,
    });
  }
  assertReasoningCapability(contract);
  const model = normalizeProviderRequestModel(request.model ?? config.model, config);
  const tools = createOpenAiResponsesTools(request, contract);
  const repaired = repairToolMessagePairing(request.messages);
  return {
    model,
    input: repaired.messages.flatMap(toOpenAiResponsesInputItem),
    stream: true,
    ...(request.promptCacheKey ? { prompt_cache_key: request.promptCacheKey } : {}),
    ...createOptionalMaxTokens("max_output_tokens", request, config),
    ...(tools && tools.length > 0
      ? {
          tools,
          tool_choice: request.toolChoice ?? "auto",
          ...(request.parallelToolCalls !== undefined
            ? { parallel_tool_calls: request.parallelToolCalls }
            : {}),
        }
      : request.toolChoice === "none"
        ? { tool_choice: "none" as const }
        : {}),
    ...(contract.sendReasoning
      ? createReasoningPayload(request.reasoningLevel ?? config.reasoningLevel)
      : {}),
  };
}

function createAnthropicMessagesProfileRequest(
  request: ModelRequest,
  config: ProviderConfig,
  contract: ProviderRuntimeContract,
): AnthropicMessagesRequest {
  // D.13H：cache_edits / cache_reference 已硬禁，无论 contextEditingEnabled 是否 true、
  // anthropicBetaHeaders 是否非空，本 builder 永不在 body 写入这两个字段；只有
  // stream() 在 sendable=true 时才会附加 anthropic-beta header。详见
  // resolveAnthropicContextEditingDiagnostic 与 model-doctor。
  if (contract.endpointProfile !== "anthropic_messages") {
    throw new LinghunError({
      code: "PROVIDER_PROFILE_MISMATCH",
      message:
        "Provider profile mismatch: anthropic_messages request builder received non-anthropic profile.",
      suggestion:
        "请检查 endpointProfile；anthropic_messages 与 chat_completions / responses schema 不能混用。",
      recoverable: true,
    });
  }
  assertReasoningCapability(contract);
  // D.13G：anthropic_messages 现在原生支持 tools；只有 contract.supportsTools=false（用户
  // 显式禁用）时才让 assertToolCapability 抛 MODEL_TOOLS_UNSUPPORTED；否则直接放过。
  assertToolCapability(request, contract);
  const model =
    config.type === "deepseek"
      ? (request.model ?? config.model)
      : normalizeProviderRequestModel(request.model ?? config.model, config);
  // Anthropic 的 system prompt 是顶层字段；从 messages 中抽出第一个 system 文本，
  // 其余 system 消息合并到 system 字段，剩下 user/assistant 按顺序保留。
  const systemSegments: Array<{
    text: string;
    promptCache?: ModelMessagePromptCacheHint;
  }> = [];
  const conversation: AnthropicMessage[] = [];
  // D.13G：跨消息追踪 assistant 已经发起但还未配对 tool_result 的 tool_use id 集合，
  // 用于 minimal pairing repair（仅在 builder 边界）：
  //   - 如果 assistant 之后没有任何 tool_result 配对该 id → 在末尾注入合成 is_error tool_result
  //   - 如果出现 orphan tool_result（id 不在已发起集合里）→ 直接丢弃；不产生 user 消息
  const pendingToolUseIds = new Set<string>();
  const repaired = repairToolMessagePairing(request.messages);
  for (const message of repaired.messages) {
    if (message.role === "system") {
      if (message.content) {
        systemSegments.push({ text: message.content, promptCache: message.promptCache });
      }
      continue;
    }
    if (message.role === "user") {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content) {
        const textBlock: AnthropicTextBlock = { type: "text", text: message.content };
        blocks.push(textBlock);
      }
      if (blocks.length > 0) {
        conversation.push({
          role: "user",
          content: request.promptCacheEnabled
            ? blocks
            : blocks.length === 1
              ? message.content
              : blocks,
        });
      }
      continue;
    }
    if (message.role === "assistant") {
      const toolCalls = message.toolCalls ?? [];
      if (toolCalls.length === 0) {
        conversation.push({
          role: "assistant",
          content: request.promptCacheEnabled
            ? [{ type: "text", text: message.content }]
            : message.content,
        });
        continue;
      }
      const blocks: AnthropicContentBlock[] = [];
      if (message.content) {
        blocks.push({ type: "text", text: message.content });
      }
      for (const toolCall of toolCalls) {
        blocks.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input ?? {},
        });
        pendingToolUseIds.add(toolCall.id);
      }
      conversation.push({ role: "assistant", content: blocks });
      continue;
    }
    if (message.role === "tool") {
      // tool role 必须配对到 user 消息的 tool_result block。
      if (!pendingToolUseIds.has(message.tool_call_id)) {
        // Orphan tool_result：没有对应的 assistant tool_use（可能上游历史被截断/重排）。
        // 最小修复：直接丢弃该 tool 消息，避免 Anthropic 400；不静默吞错误，
        // 但本 builder 边界不引入"折叠为 text summary"等结构改动。
        continue;
      }
      pendingToolUseIds.delete(message.tool_call_id);
      const toolResultBlock: AnthropicToolResultBlock = {
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: message.content,
        ...(isSyntheticToolResultError(message.content) ? { is_error: true } : {}),
      };
      // 末位 user 消息合并 tool_result block，避免在 Anthropic 强制 user/assistant 交替时
      // 因为多个 tool 消息被拆成多个独立 user 消息而违反契约。
      const last = conversation[conversation.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(toolResultBlock);
      } else {
        conversation.push({ role: "user", content: [toolResultBlock] });
      }
    }
  }
  // D.13G：assistant 已经发起 tool_use 但流尾没有配对 tool_result → 注入合成 is_error
  // tool_result，让 Anthropic 在下一轮可以稳定继续；不静默丢弃 tool_use。
  // Phase B2.16: normal traffic should already be repaired before this builder;
  // retain this branch as a defense-only protocol guard for truncated/stale history.
  if (pendingToolUseIds.size > 0) {
    const repairBlocks: AnthropicToolResultBlock[] = [];
    for (const toolUseId of pendingToolUseIds) {
      repairBlocks.push({
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "<missing tool_result; synthesized by Linghun>",
        is_error: true,
      });
    }
    const last = conversation[conversation.length - 1];
    if (last && last.role === "user" && Array.isArray(last.content)) {
      last.content.push(...repairBlocks);
    } else {
      conversation.push({ role: "user", content: repairBlocks });
    }
  }
  const body: AnthropicMessagesRequest = {
    model,
    messages: conversation,
    max_tokens: resolveMaxOutputTokens(model, request, config),
    stream: true,
  };
  // D.13K：Anthropic Messages extended thinking 注入。
  // 仅在 contract.sendReasoning=true 时附加；Low/Medium/High 分别映射为
  // 1024/4096/8192。其它等级在 builder 入口明确报 unsupported，不做静默回退。
  // max_tokens 安全处理：thinking budget 必须严格小于 max_tokens；
  // 不足时把 max_tokens 抬到 budget + 1024，保证 Anthropic 不返回 invalid_request_error。
  if (contract.sendReasoning) {
    const thinking = createAnthropicThinkingPayload(
      request.reasoningLevel ?? config.reasoningLevel,
    );
    if (thinking) {
      body.thinking = thinking;
      const minMaxTokens = thinking.budget_tokens + 1024;
      if (body.max_tokens < minMaxTokens) {
        body.max_tokens = minMaxTokens;
      }
    }
  }
  // D.13G：tools 走 Anthropic 原生 schema，按 name 字典序稳定排序（与 OpenAI 路径一致），
  // 用于保护 prompt cache 前缀 hash。tool_choice 默认 "auto"；显式 "none" 时同步透传。
  if (contract.supportsTools && request.tools && request.tools.length > 0) {
    body.tools = createAnthropicTools(request);
    body.tool_choice =
      request.toolChoice === "none"
        ? { type: "none" }
        : {
            type: "auto",
            ...(request.parallelToolCalls === false ? { disable_parallel_tool_use: true } : {}),
          };
  }
  if (request.promptCacheEnabled) {
    const messageBreakpoint = findLatestMessageCacheBreakpoint(conversation);
    if (messageBreakpoint) {
      messageBreakpoint.cache_control = createAnthropicCacheControl(request);
    }
  }
  if (systemSegments.length > 0) {
    // D.13F：promptCacheEnabled=true 时，system 写为 block array，并在稳定 system 边界挂
    // cache_control（两段时挂第一个稳定段；5m 默认不写 ttl 字面量；1h 显式时才写 ttl: "1h"）。
    // 关闭时仍走 string 形态，request body 不会出现 cache_control 字段，避免误触发缓存计费。
    // cacheBreakNonce 仅在 enabled 且非空时附加到同一个 cache 边界 block，破坏前缀 hash。
    if (request.promptCacheEnabled) {
      const cacheControlIndex = selectAnthropicSystemCacheControlIndex(systemSegments);
      const blocks: AnthropicSystemBlock[] = systemSegments.map((segment, index) => {
        const isCacheBoundary = index === cacheControlIndex;
        const text =
          isCacheBoundary && request.cacheBreakNonce
            ? `${segment.text}\n<!-- linghun-break-cache:${request.cacheBreakNonce} -->`
            : segment.text;
        if (!isCacheBoundary) {
          return { type: "text", text };
        }
        return { type: "text", text, cache_control: createAnthropicCacheControl(request) };
      });
      body.system = blocks;
    } else {
      body.system = systemSegments.map((segment) => segment.text).join("\n\n");
    }
  }
  return body;
}

function selectAnthropicSystemCacheControlIndex(
  systemSegments: Array<{ text: string; promptCache?: ModelMessagePromptCacheHint }>,
): number | undefined {
  if (systemSegments.length === 0) return undefined;
  const hasExplicitHints = systemSegments.some((segment) => segment.promptCache !== undefined);
  if (!hasExplicitHints) {
    return systemSegments.length > 1 ? 0 : systemSegments.length - 1;
  }
  for (let index = systemSegments.length - 1; index >= 0; index -= 1) {
    if (systemSegments[index]?.promptCache === "cacheable") return index;
  }
  return undefined;
}

function findLatestMessageCacheBreakpoint(
  conversation: AnthropicMessage[],
): AnthropicContentBlock | undefined {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (!message || !Array.isArray(message.content)) continue;
    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.content[blockIndex];
      if (block) return block;
    }
  }
  return undefined;
}

function createAnthropicCacheControl(request: ModelRequest): AnthropicCacheControl {
  return request.promptCacheTtl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

function createAnthropicTools(request: ModelRequest): AnthropicToolDefinition[] | undefined {
  // D.13G：tools 数组按 name 字典序稳定排序，与 OpenAI chat/responses 路径一致；
  // D.13L：启用 prompt cache 时在稳定 tool schema block 末尾挂 cache_control，
  // 让 Anthropic 同时缓存长 system prefix 与稳定工具定义，减少大工具集反复写入。
  const tools = request.tools ?? [];
  const { stableTools, dynamicTools } = partitionAnthropicCacheTools(tools);
  const sortedTools = [...stableTools, ...dynamicTools];
  const cacheControlToolIndex = stableTools.length - 1;
  const customTools = sortedTools.map((tool, index) => ({
    ...getCachedAnthropicToolBase(tool),
    ...(request.promptCacheEnabled && index === cacheControlToolIndex
      ? { cache_control: createAnthropicCacheControl(request) }
      : {}),
  }));
  return shouldAttachHostedWebSearch(request)
    ? [...customTools, createAnthropicWebSearchTool()]
    : customTools;
}

function partitionAnthropicCacheTools(tools: ModelToolDefinition[]): {
  stableTools: ModelToolDefinition[];
  dynamicTools: ModelToolDefinition[];
} {
  const stableTools: ModelToolDefinition[] = [];
  const dynamicTools: ModelToolDefinition[] = [];
  for (const tool of tools) {
    if (isDynamicToolDefinition(tool)) dynamicTools.push(tool);
    else stableTools.push(tool);
  }
  return {
    stableTools: stableTools.sort(compareToolCacheIdentity),
    dynamicTools: dynamicTools.sort(compareToolCacheIdentity),
  };
}

function compareToolCacheIdentity(a: ModelToolDefinition, b: ModelToolDefinition): number {
  return (
    a.name.localeCompare(b.name) ||
    resolveToolSource(a).localeCompare(resolveToolSource(b)) ||
    resolveToolSchemaHash(a).localeCompare(resolveToolSchemaHash(b))
  );
}

function isDynamicToolDefinition(tool: ModelToolDefinition): boolean {
  const source = resolveToolSource(tool);
  return source === "mcp" || source === "skill" || source === "plugin";
}

function resolveToolSource(tool: ModelToolDefinition): ModelToolDefinitionSource {
  if (tool.source) return tool.source;
  if (tool.name.startsWith("mcp__")) return "mcp";
  if (tool.name.startsWith("skill__")) return "skill";
  if (tool.name.startsWith("plugin__")) return "plugin";
  return "unknown";
}

function resolveToolSchemaHash(tool: ModelToolDefinition): string {
  return tool.schemaHash ?? createStableToolIdentityHash(createToolCacheIdentity(tool));
}

function getCachedAnthropicToolBase(tool: ModelToolDefinition): CachedAnthropicToolBase {
  return getCachedToolSchemaBase(`anthropic:${resolveToolSchemaHash(tool)}`, () => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function getCachedOpenAiChatToolBase(tool: ModelToolDefinition): CachedOpenAiChatToolBase {
  return getCachedToolSchemaBase(`openai-chat:${resolveToolSchemaHash(tool)}`, () => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function getCachedOpenAiResponsesToolBase(tool: ModelToolDefinition): CachedOpenAiResponsesToolBase {
  return getCachedToolSchemaBase(`openai-responses:${resolveToolSchemaHash(tool)}`, () => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

function getCachedToolSchemaBase<T>(key: string, create: () => T): T {
  const cached = toolSchemaBaseCache.get(key) as T | undefined;
  if (cached) return cached;
  const value = create();
  if (toolSchemaBaseCache.size >= TOOL_SCHEMA_BASE_CACHE_LIMIT) {
    const firstKey = toolSchemaBaseCache.keys().next().value;
    if (typeof firstKey === "string") toolSchemaBaseCache.delete(firstKey);
  }
  toolSchemaBaseCache.set(key, value);
  return value;
}

function createToolCacheIdentity(tool: ModelToolDefinition): {
  name: string;
  description: string;
  inputSchema: unknown;
  source: ModelToolDefinitionSource;
} {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    source: resolveToolSource(tool),
  };
}

function createStableToolIdentityHash(value: unknown): string {
  return createHash("sha256").update(stableToolIdentityString(value)).digest("hex").slice(0, 12);
}

function stableToolIdentityString(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableToolIdentityString(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${key}:${stableToolIdentityString(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
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

function createOptionalMaxTokens<K extends "max_tokens" | "max_output_tokens">(
  key: K,
  request: ModelRequest,
  config: ProviderConfig,
): Partial<Record<K, number>> {
  const model = request.model ?? config.model;
  const known = findKnownModel(model);
  // Phase 6.5: 已知模型取自身 maxOutputTokens；未知模型补默认 16384。
  // 用户显式配置（request.maxOutputTokens / config.maxOutputTokens）始终优先。
  const modelCap = known?.maxOutputTokens ?? 16_384;
  const configured = request.maxOutputTokens ?? config.maxOutputTokens;
  const value = configured ?? modelCap;
  return { [key]: value } as Record<K, number>;
}

function createOpenAiChatTools(
  request: ModelRequest,
  contract: ProviderRuntimeContract,
): Array<OpenAiToolDefinition | OpenAiChatWebSearchToolDefinition> | undefined {
  assertToolCapability(request, contract);
  // D.13F：tools 数组按 name 字典序稳定排序，避免上层迭代顺序波动破坏 OpenAI 隐式
  // prompt cache 的前缀 hash。chat profile 不传 prompt_cache_key；Responses profile
  // 可由 TUI 注入稳定 promptCacheKey。
  const tools = request.tools;
  if (!tools) return undefined;
  const customTools = tools
    .filter(
      (tool) => contract.compatibilityProfile !== "gemini" || tool.name !== "WebSearch",
    )
    .sort(compareToolCacheIdentity)
    .map((tool) => getCachedOpenAiChatToolBase(tool));
  return contract.compatibilityProfile === "gemini" && request.toolChoice !== "none"
    ? [...customTools, { type: "web_search_preview" }]
    : customTools;
}

function createOpenAiResponsesTools(
  request: ModelRequest,
  contract: ProviderRuntimeContract,
): OpenAiResponsesToolDefinition[] | undefined {
  assertToolCapability(request, contract);
  // D.13F：与 chat tools 一致，按 name 字典序稳定排序。
  const tools = request.tools;
  if (!tools) return undefined;
  const customTools = tools
    .filter((tool) => contract.compatibilityProfile !== "grok" || tool.name !== "WebSearch")
    .sort(compareToolCacheIdentity)
    .map((tool) => getCachedOpenAiResponsesToolBase(tool));
  return shouldAttachHostedWebSearch(request)
    ? [...customTools, createOpenAiResponsesWebSearchTool()]
    : customTools;
}

function shouldAttachHostedWebSearch(request: ModelRequest): boolean {
  return request.toolChoice !== "none" && Boolean(request.tools?.length);
}

function createOpenAiResponsesWebSearchTool(): OpenAiResponsesWebSearchToolDefinition {
  return {
    type: "web_search",
    external_web_access: true,
  };
}

function createAnthropicWebSearchTool(): AnthropicToolDefinition {
  return {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 8,
  };
}

function shouldAttachChatNativeWebSearch(
  request: ModelRequest,
  config: ProviderConfig,
  contract: ProviderRuntimeContract,
): boolean {
  return (
    request.toolChoice !== "none" &&
    Boolean(request.tools?.length) &&
    config.type === "openai-compatible" &&
    contract.endpointProfile === "chat_completions"
  );
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

function assertReasoningCapability(contract: ProviderRuntimeContract): void {
  const level = contract.unsupportedReasoningLevel;
  if (!level) {
    return;
  }
  const supported =
    contract.profile === "openai_responses"
      ? "Low / Medium / High / XHigh / Max"
      : contract.profile === "anthropic_messages" || contract.profile === "gemini_chat_completions"
        ? "Low / Medium / High"
        : "Low / Medium / High / Max";
  throw new LinghunError({
    code: "MODEL_REASONING_LEVEL_UNSUPPORTED",
    message: `Reasoning level ${JSON.stringify(level)} is unsupported for provider profile ${contract.profile}.`,
    suggestion: `请为当前 provider/profile 选择已验证等级：${supported}；Linghun 不会静默回退到 Medium。`,
    recoverable: true,
  });
}

const TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

export function repairToolMessagePairing(messages: ModelMessage[]): ToolMessagePairingRepair {
  const issues: ToolMessagePairingIssue[] = [];
  const pending = new Map<string, ModelToolCall>();
  const emittedResults = new Set<string>();
  const repaired: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      const seenInMessage = new Set<string>();
      const toolCalls: ModelToolCall[] = [];
      for (const toolCall of message.toolCalls ?? []) {
        if (!isValidToolMessageId(toolCall.id)) {
          issues.push("invalid_tool_call_id");
          continue;
        }
        if (pending.has(toolCall.id) || seenInMessage.has(toolCall.id)) {
          issues.push("duplicate_tool_call_id");
          continue;
        }
        pending.set(toolCall.id, toolCall);
        seenInMessage.add(toolCall.id);
        toolCalls.push(toolCall);
      }
      repaired.push(
        toolCalls.length > 0
          ? { ...message, toolCalls }
          : { role: "assistant", content: message.content },
      );
      continue;
    }

    if (message.role === "tool") {
      if (!isValidToolMessageId(message.tool_call_id)) {
        issues.push("invalid_tool_result_id");
        continue;
      }
      if (!pending.has(message.tool_call_id)) {
        issues.push("orphan_tool_result");
        continue;
      }
      if (emittedResults.has(message.tool_call_id)) {
        issues.push("duplicate_tool_result");
        continue;
      }
      pending.delete(message.tool_call_id);
      emittedResults.add(message.tool_call_id);
      repaired.push(message);
      continue;
    }

    repaired.push(message);
  }

  for (const toolUseId of pending.keys()) {
    issues.push("missing_tool_result");
    repaired.push({
      role: "tool",
      tool_call_id: toolUseId,
      content: JSON.stringify({
        ok: false,
        text: "missing tool_result; synthesized by Linghun before provider request",
        isError: true,
      }),
    });
  }

  return { messages: repaired, issues };
}

function isValidToolMessageId(id: string): boolean {
  return TOOL_CALL_ID_PATTERN.test(id);
}

function isSyntheticToolResultError(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { isError?: unknown; ok?: unknown };
    return parsed.isError === true || parsed.ok === false;
  } catch {
    return false;
  }
}

function createReasoningPayload(level: string | undefined): { reasoning?: { effort: string } } {
  if (!level) {
    return {};
  }
  return { reasoning: { effort: normalizeOpenAiReasoningEffort(level) } };
}

function normalizeOpenAiReasoningEffort(level: string): string {
  const normalized = level.trim().toLowerCase();
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh" ||
    normalized === "max"
  ) {
    return normalized;
  }
  return level;
}

// D.13K：Anthropic Messages extended thinking budget 映射。
// Low → 1024 / Medium → 4096 / High → 8192；其它字符串由 capability gate 拒绝。
// 仅由 createAnthropicMessagesProfileRequest 在 contract.sendReasoning=true 时调用，
// 不复用 OpenAI reasoning.effort 字段；OpenAI 路径不会触发该 helper。
function createAnthropicThinkingPayload(
  level: string | undefined,
): AnthropicThinkingConfig | undefined {
  if (!level) return undefined;
  const normalized = level.trim().toLowerCase();
  let budget: number;
  if (normalized === "low") budget = 1024;
  else if (normalized === "medium") budget = 4096;
  else if (normalized === "high") budget = 8192;
  else return undefined;
  return { type: "enabled", budget_tokens: budget };
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
    return { role: "tool", content: message.content, tool_call_id: message.tool_call_id };
  }
  return { role: message.role, content: message.content };
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
  return [{ role: message.role, content: message.content }];
}

export async function* parseOpenAiStream(
  body: ReadableStream<Uint8Array>,
  endpoint = "/v1/chat/completions",
): AsyncGenerator<LinghunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamDone = false;
  const state: OpenAiStreamParseState = {
    pendingToolCalls: new Map(),
    pendingResponsesToolCalls: new Map(),
    chunkCount: 0,
    finishReason: undefined,
    hadUsage: false,
    hadText: false,
    lastId: "assistant",
    streamComplete: false,
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        streamDone = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > PROVIDER_SSE_BUFFER_LIMIT_CHARS) {
        yield createProviderStreamLimitError(
          "SSE buffer",
          endpoint,
          PROVIDER_SSE_BUFFER_LIMIT_CHARS,
        );
        return;
      }
      let separator = findSseEventSeparator(buffer);
      while (separator) {
        const eventBlock = buffer.slice(0, separator.index);
        if (eventBlock.length > PROVIDER_SSE_EVENT_LIMIT_CHARS) {
          yield createProviderStreamLimitError(
            "SSE event",
            endpoint,
            PROVIDER_SSE_EVENT_LIMIT_CHARS,
          );
          return;
        }
        buffer = buffer.slice(separator.index + separator.length);
        for (const event of parseOpenAiStreamEventBlock(eventBlock, state, endpoint)) {
          markOpenAiStreamCompleteOnError(event, state);
          yield event;
        }
        separator = findSseEventSeparator(buffer);
      }
    }

    const tail = decoder.decode();
    if (tail) {
      buffer += tail;
    }
    if (buffer.length > PROVIDER_SSE_EVENT_LIMIT_CHARS) {
      yield createProviderStreamLimitError("SSE event", endpoint, PROVIDER_SSE_EVENT_LIMIT_CHARS);
      return;
    }
    if (buffer.trim().length > 0) {
      for (const event of parseOpenAiStreamEventBlock(buffer, state, endpoint)) {
        markOpenAiStreamCompleteOnError(event, state);
        yield event;
      }
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
      state.streamComplete = true;
    }
    if (!state.streamComplete) {
      yield createProviderIncompleteStreamError(endpoint, "OpenAI compatible stream closed before a terminal event");
      return;
    }
    yield {
      type: "message_stop",
      id: state.lastId,
      finishReason: state.finishReason,
      chunkCount: state.chunkCount,
      hadUsage: state.hadUsage,
    };
  } finally {
    if (!streamDone) {
      await reader.cancel().catch(() => undefined);
    }
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released by the runtime after cancel.
    }
  }
}

function createProviderIncompleteStreamError(endpoint: string, detail: string): LinghunEvent {
  return {
    type: "error",
    error: new LinghunError({
      code: "PROVIDER_STREAM_ERROR",
      message: "模型请求失败：provider 流式响应在终止事件前提前结束。",
      suggestion: `请重试；如持续出现，运行 /model doctor 检查 ${endpoint} 流式接口、网关稳定性和 endpoint profile。`,
      cause: new Error(detail),
      recoverable: true,
    }),
  };
}

function isProviderIncompleteStreamErrorEvent(event: LinghunEvent): boolean {
  return (
    event.type === "error" &&
    event.error.code === "PROVIDER_STREAM_ERROR" &&
    event.error.message.includes("终止事件前提前结束")
  );
}

function findSseEventSeparator(value: string): { index: number; length: number } | undefined {
  const candidates = [
    { index: value.indexOf("\r\n\r\n"), length: 4 },
    { index: value.indexOf("\n\n"), length: 2 },
    { index: value.indexOf("\r\r"), length: 2 },
  ].filter((candidate) => candidate.index >= 0);
  candidates.sort((left, right) => left.index - right.index);
  return candidates[0];
}

function markOpenAiStreamCompleteOnError(
  event: LinghunEvent,
  state: OpenAiStreamParseState,
): void {
  if (event.type === "error") state.streamComplete = true;
}

function parseOpenAiStreamEventBlock(
  block: string,
  state: OpenAiStreamParseState,
  endpoint = "/v1/chat/completions",
): LinghunEvent[] {
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r?\n|\r/u)) {
    const line = rawLine.trim();
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) return [];
  return parseOpenAiStreamLine(`data: ${dataLines.join("\n")}`, state, endpoint);
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
  let streamDone = false;
  const state: AnthropicStreamParseState = {
    chunkCount: 0,
    hadUsage: false,
    hadText: false,
    lastId: "assistant",
    inputTokens: 0,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
    rawUsage: undefined,
    pendingToolUses: new Map(),
    streamComplete: false,
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        streamDone = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > PROVIDER_SSE_BUFFER_LIMIT_CHARS) {
        yield createProviderStreamLimitError(
          "SSE buffer",
          endpoint,
          PROVIDER_SSE_BUFFER_LIMIT_CHARS,
        );
        return;
      }
      // Split on complete SSE event frames; relays may use LF, CRLF, or CR separators.
      let separator = findSseEventSeparator(buffer);
      while (separator) {
        const eventBlock = buffer.slice(0, separator.index);
        if (eventBlock.length > PROVIDER_SSE_EVENT_LIMIT_CHARS) {
          yield createProviderStreamLimitError(
            "SSE event",
            endpoint,
            PROVIDER_SSE_EVENT_LIMIT_CHARS,
          );
          return;
        }
        buffer = buffer.slice(separator.index + separator.length);
        for (const event of parseAnthropicMessagesEventBlock(eventBlock, state, endpoint)) {
          markAnthropicStreamCompleteOnError(event, state);
          yield event;
        }
        separator = findSseEventSeparator(buffer);
      }
    }

    const tail = decoder.decode();
    if (tail) buffer += tail;
    if (buffer.length > PROVIDER_SSE_EVENT_LIMIT_CHARS) {
      yield createProviderStreamLimitError("SSE event", endpoint, PROVIDER_SSE_EVENT_LIMIT_CHARS);
      return;
    }
    if (buffer.trim().length > 0) {
      for (const event of parseAnthropicMessagesEventBlock(buffer, state, endpoint)) {
        markAnthropicStreamCompleteOnError(event, state);
        yield event;
      }
    }

    if (state.pendingToolUses.size > 0) {
      state.pendingToolUses.clear();
      yield {
        type: "error",
        error: new LinghunError({
          code: "PROVIDER_PARTIAL_TOOL_CALL",
          message: "模型请求失败：Anthropic 流结束时仍有未完成的 tool_use。",
          suggestion:
            "请重试；如持续出现，运行 /model doctor 检查 provider 的 Anthropic Messages tool_use 流式兼容性或切换 provider/model。",
          recoverable: true,
        }),
      };
      state.streamComplete = true;
    }

    if (!state.streamComplete) {
      yield createProviderIncompleteStreamError(endpoint, "Anthropic Messages stream closed before message_stop");
      return;
    }

    yield {
      type: "message_stop",
      id: state.lastId,
      finishReason: state.finishReason,
      chunkCount: state.chunkCount,
      hadUsage: state.hadUsage,
    };
  } finally {
    if (!streamDone) {
      await reader.cancel().catch(() => undefined);
    }
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released by the runtime after cancel.
    }
  }
}

function markAnthropicStreamCompleteOnError(
  event: LinghunEvent,
  state: AnthropicStreamParseState,
): void {
  if (event.type === "error") state.streamComplete = true;
}

type AnthropicPendingToolUse = {
  id: string;
  name: string;
  argsBuffer: string;
};

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
  // D.13G：跨事件追踪每个 content_block index 上的 tool_use 状态。
  // content_block_start(tool_use) 时建立 entry，input_json_delta 累积 partial_json，
  // content_block_stop 时 JSON.parse 并 emit 单个 LinghunEvent.tool_use。
  pendingToolUses: Map<number, AnthropicPendingToolUse>;
  streamComplete: boolean;
};

function parseAnthropicMessagesEventBlock(
  block: string,
  state: AnthropicStreamParseState,
  endpoint: string,
): LinghunEvent[] {
  // 在一个 SSE 事件块里寻找 data 行；忽略 event:、id:、retry: 等头。
  const lines = block.split(/\r?\n|\r/u);
  const dataLines: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) return [];
  const payload = dataLines.join("\n");
  if (!payload || payload === "[DONE]") {
    if (payload === "[DONE]") state.streamComplete = true;
    return [];
  }

  let parsed: AnthropicStreamEvent;
  try {
    parsed = JSON.parse(payload) as AnthropicStreamEvent;
  } catch (error) {
    state.streamComplete = true;
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
    state.streamComplete = true;
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
      state.cacheWriteTokens = normalizeAnthropicCacheWriteTokens(usage);
      state.rawUsage = usage;
    }
    return [];
  }

  if (parsed.type === "content_block_start") {
    // D.13G：tool_use 块开始时建立 pendingToolUses entry；text/其它块不产 LinghunEvent。
    const block = parsed.content_block;
    const blockIndex = parsed.index;
    if (block?.type === "tool_use" && typeof blockIndex === "number") {
      const id = typeof block.id === "string" ? block.id : "";
      const name = typeof block.name === "string" ? block.name : "";
      if (!id || !name) {
        return [
          {
            type: "error",
            error: new LinghunError({
              code: "PROVIDER_MALFORMED_STREAM",
              message: "模型请求失败：Anthropic 流式 tool_use 缺 id 或 name。",
              suggestion:
                "请运行 /model doctor 检查 provider 是否完整支持 Anthropic Messages tool_use 流式协议；如持续出现请切换 provider/model。",
              recoverable: true,
            }),
          },
        ];
      }
      state.pendingToolUses.set(blockIndex, { id, name, argsBuffer: "" });
    }
    // D.13M：redacted_thinking 整块（block.type === "redacted_thinking"）在 content_block_start 直接出现。
    // 不暴露 block.data；只用空字符串 thinking_delta 标记本轮"曾发生 thinking"，让 TUI 走 thinking-only 文案。
    if (block?.type === "redacted_thinking") {
      return [{ type: "assistant_thinking_delta", id: state.lastId, text: "" }];
    }
    return [];
  }

  if (parsed.type === "content_block_delta") {
    const delta = parsed.delta;
    if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
      state.hadText = true;
      return [{ type: "assistant_text_delta", id: state.lastId, text: delta.text }];
    }
    // D.13M：Anthropic extended thinking 流。
    // - thinking_delta：携带 thinking 文本，作为 assistant_thinking_delta emit；不写主屏，不进 transcript。
    // - signature_delta：thinking 块的签名片段，Linghun 不展示，静默忽略，不计错误，不算空响应。
    // - redacted_thinking：作为 delta 出现时（部分 relay 实现），不暴露 redacted 数据，仅以空字符串 thinking_delta
    //   标记本轮"曾发生 thinking"，让 TUI 走 thinking-only 文案。
    if (delta?.type === "thinking_delta") {
      const text = typeof delta.thinking === "string" ? delta.thinking : "";
      if (text.length === 0) return [];
      return [{ type: "assistant_thinking_delta", id: state.lastId, text }];
    }
    if (delta?.type === "signature_delta") {
      return [];
    }
    if (delta?.type === "redacted_thinking") {
      return [{ type: "assistant_thinking_delta", id: state.lastId, text: "" }];
    }
    if (delta?.type === "input_json_delta") {
      // D.13G：input_json_delta 累积 partial_json 到对应 index 上的 pendingToolUses。
      // 如果 index 上没有 tool_use entry → 视为协议错乱，emit PROVIDER_MALFORMED_STREAM。
      const blockIndex = parsed.index;
      if (typeof blockIndex !== "number") return [];
      const pending = state.pendingToolUses.get(blockIndex);
      if (!pending) {
        return [
          {
            type: "error",
            error: new LinghunError({
              code: "PROVIDER_MALFORMED_STREAM",
              message: "模型请求失败：Anthropic 流式 input_json_delta 落在非 tool_use 内容块上。",
              suggestion:
                "请运行 /model doctor 检查 provider 的 Anthropic Messages 流式实现是否完整；如持续出现请切换 provider/model。",
              recoverable: true,
            }),
          },
        ];
      }
      if (typeof delta.partial_json === "string") {
        const nextArgs = pending.argsBuffer + delta.partial_json;
        if (nextArgs.length > PROVIDER_TOOL_ARGUMENTS_LIMIT_CHARS) {
          state.pendingToolUses.delete(blockIndex);
          return [
            createProviderStreamLimitError(
              "tool arguments",
              endpoint,
              PROVIDER_TOOL_ARGUMENTS_LIMIT_CHARS,
            ),
          ];
        }
        pending.argsBuffer = nextArgs;
      }
      return [];
    }
    return [];
  }

  if (parsed.type === "content_block_stop") {
    // D.13G：tool_use 块结束 → JSON.parse 累积的 partial_json，emit 单个 LinghunEvent.tool_use。
    const blockIndex = parsed.index;
    if (typeof blockIndex !== "number") return [];
    const pending = state.pendingToolUses.get(blockIndex);
    if (!pending) return [];
    state.pendingToolUses.delete(blockIndex);
    const argsRaw = pending.argsBuffer.length > 0 ? pending.argsBuffer : "{}";
    let input: unknown;
    try {
      input = JSON.parse(argsRaw);
    } catch (error) {
      return [
        {
          type: "error",
          error: new LinghunError({
            code: "PROVIDER_MALFORMED_STREAM",
            message: "模型请求失败：Anthropic 流式 tool_use input_json 无法解析为 JSON。",
            suggestion:
              "请运行 /model doctor 检查 provider 的 Anthropic Messages 流式实现是否完整；如持续出现请切换 provider/model。",
            cause: error,
            recoverable: true,
          }),
        },
      ];
    }
    return [{ type: "tool_use", id: pending.id, name: pending.name, input }];
  }

  if (parsed.type === "message_delta") {
    const stopReason = parsed.delta?.stop_reason;
    if (stopReason) state.finishReason = stopReason;
    const usage = parsed.usage;
    if (!usage) return [];
    state.hadUsage = true;
    const merged: AnthropicUsage = { ...(state.rawUsage ?? {}), ...usage };
    state.rawUsage = merged;
    return [
      {
        type: "usage",
        usage: normalizeProviderUsage(merged, "anthropic_messages", endpoint),
      },
    ];
  }

  if (parsed.type === "message_stop") {
    state.streamComplete = true;
    return [];
  }

  // content_block_start / content_block_stop / ping：忽略，
  // message_stop 由外层统一发出，避免重复。
  return [];
}

type OpenAiStreamParseState = {
  pendingToolCalls: Map<number, PendingOpenAiToolCall>;
  pendingResponsesToolCalls: Map<number, PendingResponsesToolCall>;
  chunkCount: number;
  finishReason?: string;
  hadUsage: boolean;
  hadText: boolean;
  lastId: string;
  streamComplete: boolean;
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
  input_tokens_details?: {
    cached_tokens?: number;
    cache_creation_tokens?: number;
  };
  cache_creation_input_tokens?: number;
  cache_creation_tokens?: number;
};

function normalizeProviderUsage(
  usage: OpenAiStreamUsage | ResponsesUsage | AnthropicUsage,
  endpointProfile: EndpointProfile,
  endpoint: string,
): ModelUsage {
  if (endpointProfile === "anthropic_messages") {
    const anthropicUsage = usage as AnthropicUsage;
    const inputTokens = anthropicUsage.input_tokens ?? 0;
    const outputTokens = anthropicUsage.output_tokens ?? 0;
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cacheReadTokens: anthropicUsage.cache_read_input_tokens,
      cacheWriteTokens: normalizeAnthropicCacheWriteTokens(anthropicUsage),
      cacheCreationEphemeral5mTokens: anthropicUsage.cache_creation?.ephemeral_5m_input_tokens,
      cacheCreationEphemeral1hTokens: anthropicUsage.cache_creation?.ephemeral_1h_input_tokens,
      rawUsage: usage,
      endpoint,
    };
  }
  if (endpointProfile === "responses") {
    const responsesUsage = usage as ResponsesUsage;
    return {
      inputTokens: responsesUsage.input_tokens ?? 0,
      outputTokens: responsesUsage.output_tokens ?? 0,
      totalTokens: responsesUsage.total_tokens ?? 0,
      cacheReadTokens: responsesUsage.input_tokens_details?.cached_tokens,
      cacheWriteTokens: readCacheWriteTokens(responsesUsage) ?? undefined,
      rawUsage: usage,
      endpoint,
    };
  }
  const chatUsage = usage as OpenAiStreamUsage;
  return {
    inputTokens: chatUsage.prompt_tokens ?? 0,
    outputTokens: chatUsage.completion_tokens ?? 0,
    totalTokens: chatUsage.total_tokens ?? 0,
    cacheReadTokens:
      chatUsage.prompt_tokens_details?.cached_tokens ?? chatUsage.cache_read_input_tokens,
    cacheWriteTokens: readCacheWriteTokens(chatUsage) ?? undefined,
    rawUsage: usage,
    endpoint,
  };
}

function extractNonStreamingUsage(
  parsed: unknown,
  endpointProfile: EndpointProfile,
  endpoint: string,
): ModelUsage | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const usage = (parsed as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  return normalizeProviderUsage(
    usage as OpenAiStreamUsage | ResponsesUsage | AnthropicUsage,
    endpointProfile,
    endpoint,
  );
}

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
    if (payload === "[DONE]") state.streamComplete = true;
    return [];
  }
  state.chunkCount += 1;

  let parsed: {
    id?: string;
    type?: string;
    output_index?: number;
    delta?: string;
    item?: {
      type?: string;
      call_id?: string;
      id?: string;
      name?: string;
      arguments?: string;
      content?: Array<{ type?: string; text?: string }>;
    };
    response?: {
      id?: string;
      usage?: ResponsesUsage;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    choices?: OpenAiStreamChoice[];
    usage?: OpenAiStreamUsage;
    error?: { message?: string; type?: string; code?: string } | string;
  };
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    state.streamComplete = true;
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
    state.streamComplete = true;
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
      state.streamComplete = true;
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
    events.push({
      type: "usage",
      usage: normalizeProviderUsage(parsed.usage, "chat_completions", endpoint),
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
    item?: {
      type?: string;
      call_id?: string;
      id?: string;
      name?: string;
      arguments?: string;
      content?: Array<{ type?: string; text?: string }>;
    };
    response?: {
      id?: string;
      usage?: ResponsesUsage;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    usage?: OpenAiStreamUsage;
  },
  state: OpenAiStreamParseState,
  endpoint: string,
): LinghunEvent[] {
  if (!parsed.type?.startsWith("response.")) {
    return [];
  }
  if (parsed.type === "response.failed" || parsed.type === "response.incomplete") {
    state.streamComplete = true;
    const outcome = parsed.type === "response.failed" ? "failed" : "incomplete";
    return [
      {
        type: "error",
        error: new LinghunError({
          code:
            parsed.type === "response.failed"
              ? "PROVIDER_RESPONSE_FAILED"
              : "PROVIDER_RESPONSE_INCOMPLETE",
          message: `模型请求失败：Responses endpoint 返回 ${parsed.type}。`,
          suggestion:
            `上游明确以 ${outcome} 结束本次响应。请重试；若重复出现，请运行 /model doctor 检查 endpoint profile、model、reasoning 和 provider 兼容性。`,
          recoverable: true,
        }),
      },
    ];
  }
  if (parsed.response?.id) {
    state.lastId = parsed.response.id;
  }
  if (parsed.type === "response.output_text.delta" && parsed.delta) {
    state.hadText = true;
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
    const initialArguments = parsed.item.arguments ?? "";
    if (initialArguments.length > PROVIDER_TOOL_ARGUMENTS_LIMIT_CHARS) {
      return [
        createProviderStreamLimitError(
          "tool arguments",
          endpoint,
          PROVIDER_TOOL_ARGUMENTS_LIMIT_CHARS,
        ),
      ];
    }
    state.pendingResponsesToolCalls.set(index, {
      id: parsed.item.call_id ?? parsed.item.id ?? `tool-${index + 1}`,
      name: parsed.item.name ?? "",
      arguments: initialArguments,
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
    const nextArguments = existing.arguments + parsed.delta;
    if (nextArguments.length > PROVIDER_TOOL_ARGUMENTS_LIMIT_CHARS) {
      state.pendingResponsesToolCalls.delete(index);
      return [
        createProviderStreamLimitError(
          "tool arguments",
          endpoint,
          PROVIDER_TOOL_ARGUMENTS_LIMIT_CHARS,
        ),
      ];
    }
    state.pendingResponsesToolCalls.set(index, {
      ...existing,
      arguments: nextArguments,
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
    if (args.length > PROVIDER_TOOL_ARGUMENTS_LIMIT_CHARS) {
      return [
        createProviderStreamLimitError(
          "tool arguments",
          endpoint,
          PROVIDER_TOOL_ARGUMENTS_LIMIT_CHARS,
        ),
      ];
    }
    return [
      {
        type: "tool_use",
        id,
        name,
        input: parseToolArguments(args),
      },
    ];
  }
  if (
    parsed.type === "response.output_item.done" &&
    parsed.item?.type === "message" &&
    !state.hadText
  ) {
    const text = extractResponsesOutputText(parsed.item.content);
    if (text) {
      state.hadText = true;
      return [
        { type: "assistant_text_delta", id: parsed.item.id ?? parsed.id ?? state.lastId, text },
      ];
    }
  }
  const response = parsed.response;
  const usage = response?.usage;
  if (parsed.type === "response.completed" && response) {
    state.streamComplete = true;
    const events: LinghunEvent[] = [];
    const text = state.hadText ? "" : extractResponsesOutputTextFromResponse(response);
    if (text) {
      state.hadText = true;
      events.push({ type: "assistant_text_delta", id: response.id ?? state.lastId, text });
    }
    if (usage) {
      state.hadUsage = true;
      events.push({
        type: "usage",
        usage: normalizeProviderUsage(usage, "responses", endpoint),
      });
    }
    return events;
  }
  return [];
}

function extractResponsesOutputText(
  content: Array<{ type?: string; text?: string }> | undefined,
): string {
  return (content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

function extractResponsesOutputTextFromResponse(response: {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}): string {
  return (response.output ?? [])
    .filter((item) => item.type === "message")
    .map((item) => extractResponsesOutputText(item.content))
    .join("");
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
    const nextArguments = existing.arguments + (toolCall.function?.arguments ?? "");
    if (nextArguments.length > PROVIDER_TOOL_ARGUMENTS_LIMIT_CHARS) {
      state.pendingToolCalls.delete(index);
      events.push(
        createProviderStreamLimitError(
          "tool arguments",
          "/v1/chat/completions",
          PROVIDER_TOOL_ARGUMENTS_LIMIT_CHARS,
        ),
      );
      continue;
    }
    const next = {
      id: toolCall.id ?? existing.id,
      name: toolCall.function?.name || existing.name,
      arguments: nextArguments,
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

function normalizeAnthropicCacheWriteTokens(usage: AnthropicUsage): number | undefined {
  if (typeof usage.cache_creation_input_tokens === "number")
    return usage.cache_creation_input_tokens;
  const ephemeral5m = usage.cache_creation?.ephemeral_5m_input_tokens;
  const ephemeral1h = usage.cache_creation?.ephemeral_1h_input_tokens;
  if (typeof ephemeral5m !== "number" && typeof ephemeral1h !== "number") return undefined;
  return Math.max(0, ephemeral5m ?? 0) + Math.max(0, ephemeral1h ?? 0);
}

function readCacheWriteTokens(usage: {
  prompt_tokens_details?: { cache_creation_tokens?: number };
  input_tokens_details?: { cache_creation_tokens?: number };
  cache_creation_input_tokens?: number;
  cache_creation_tokens?: number;
}): number | null {
  if (typeof usage.prompt_tokens_details?.cache_creation_tokens === "number") {
    return usage.prompt_tokens_details.cache_creation_tokens;
  }
  if (typeof usage.input_tokens_details?.cache_creation_tokens === "number") {
    return usage.input_tokens_details.cache_creation_tokens;
  }
  if (typeof usage.cache_creation_input_tokens === "number") {
    return usage.cache_creation_input_tokens;
  }
  if (typeof usage.cache_creation_tokens === "number") {
    return usage.cache_creation_tokens;
  }
  return null;
}

export class GeminiProvider extends OpenAiCompatibleProvider {}

export class GrokProvider extends OpenAiCompatibleProvider {}

export class DeepSeekProvider extends OpenAiCompatibleProvider {
  constructor(config: Omit<ProviderConfig, "type" | "id"> & Partial<Pick<ProviderConfig, "id">>) {
    super({
      ...config,
      id: config.id ?? "deepseek",
      type: "deepseek",
      displayName: config.displayName ?? "DeepSeek",
      baseUrl: config.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL,
    });
  }
}

registerClientFactories({
  chat: ({ request, config, contract }) => createChatProfileRequest(request, config, contract),
  responses: ({ request, config, contract }) =>
    createResponsesProfileRequest(request, config, contract),
  anthropicMessages: ({ request, config, contract }) =>
    createAnthropicMessagesProfileRequest(request, config, contract),
});

export function normalizeProviderError(error: unknown): LinghunError {
  if (error instanceof LinghunError) {
    return error;
  }
  if (isProviderAbortError(error)) {
    return createProviderAbortError(error);
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
    const streamFailureCode = classifyProviderStreamFailure(error.message);
    if (streamFailureCode) {
      return new LinghunError({
        code: streamFailureCode,
        message: `模型响应流传输失败：${maskSensitiveFragments(error.message)}`,
        suggestion:
          "这通常是 provider 或网络传输层的临时问题。请稍后重试；反复出现时运行 /model doctor 查看配置摘要。",
        cause: error,
        recoverable: true,
      });
    }
    return new LinghunError({
      code: "PROVIDER_ERROR",
      message: `模型请求失败：${maskSensitiveFragments(error.message)}`,
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

function isProviderAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "AbortError" || candidate.code === "ABORT_ERR";
}

function createProviderAbortError(cause?: unknown): LinghunError {
  return new LinghunError({
    code: "ABORT_ERR",
    message: "Request aborted.",
    cause,
    recoverable: false,
  });
}

function classifyProviderStreamFailure(
  message: string,
): "PROVIDER_STREAM_DECODE_ERROR" | "PROVIDER_RETRY_EXHAUSTED" | null {
  if (/retry\s*exhausted|重试.*耗尽/iu.test(message)) {
    return "PROVIDER_RETRY_EXHAUSTED";
  }
  if (
    /crc|checksum|eventstream|event[-\s]?stream|stream\s*decode|decode\s*(?:error|failed|mismatch)|malformed\s*(?:sse|stream|chunk)|流.*解码|解码.*失败|校验.*不一致/iu.test(
      message,
    )
  ) {
    return "PROVIDER_STREAM_DECODE_ERROR";
  }
  return null;
}

interface ProviderErrorContext {
  endpointProfile: EndpointProfile;
  endpoint: string;
  responseText?: string;
}

function formatErrorContextSuffix(context?: ProviderErrorContext): string {
  if (!context) {
    return "";
  }
  return `（endpointProfile=${context.endpointProfile}，endpoint=${context.endpoint}）`;
}

function maskSensitiveFragments(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9_.\-+/=]+/gi, "Bearer ***")
    .replace(/x-api-key\s*[:=]\s*[A-Za-z0-9_.\-+/=]+/gi, "x-api-key: ***")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "eyJ***");
}

function createApiKeyError(
  status: number,
  cause?: unknown,
  context?: ProviderErrorContext,
): LinghunError {
  const suffix = formatErrorContextSuffix(context);
  return new LinghunError({
    code: "PROVIDER_API_KEY_ERROR",
    message: `模型请求失败：API Key 无效或没有权限（HTTP ${status}${suffix ? `，${suffix.slice(1, -1)}` : ""}）。`,
    suggestion:
      context && context.endpointProfile === "anthropic_messages"
        ? "请检查当前 provider 的 api_key 是否对该网关有效；anthropic_messages 同时使用 x-api-key 和 Authorization Bearer，确认两个都被网关接受，再运行 /model doctor 复查配置。"
        : "请检查当前 provider 的 api_key 是否正确，或运行 /model doctor 复查配置。",
    cause,
    recoverable: true,
  });
}

function sanitizeProviderBadRequestHint(responseText?: string): string | undefined {
  if (!responseText) {
    return undefined;
  }
  const compact = maskSensitiveFragments(responseText).replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  const lower = compact.toLowerCase();
  if (lower.includes("authentication_error")) {
    return "provider returned authentication_error";
  }
  if (lower.includes("permission_error")) {
    return "provider returned permission_error";
  }
  if (lower.includes("not_found_error")) {
    return "provider returned not_found_error (check baseUrl/endpoint/model)";
  }
  if (lower.includes("invalid_request_error")) {
    return "provider returned invalid_request_error; check anthropic schema/model/tool_choice";
  }
  if (lower.includes("overloaded_error")) {
    return "provider returned overloaded_error";
  }
  if (lower.includes("anthropic-version") || lower.includes("x-api-key")) {
    return "provider rejected anthropic auth/version headers";
  }
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
  if (lower.includes("api_error")) {
    return "provider returned generic api_error";
  }
  return "provider rejected request body; check schema/profile/model";
}

function isQuotaOrBalanceExhaustedResponse(responseText?: string): boolean {
  if (!responseText) {
    return false;
  }
  const lower = maskSensitiveFragments(responseText).toLowerCase();
  return /insufficient[_\s-]?quota|quota\s*(?:exhausted|exceeded|limit|reached)|credits?\s*(?:exhausted|used\s*up|insufficient|limit)|balance\s*(?:exhausted|insufficient|too\s*low|不足)|billing\s*(?:hard\s*limit|limit|required|payment)|payment[_\s-]?required|account\s+balance|余额不足|额度不足|欠费|充值/iu.test(
    lower,
  );
}

function createHttpStatusError(
  status: number,
  responseText?: string,
  providerType?: ProviderConfig["type"],
  context?: ProviderErrorContext,
): LinghunError {
  const suffix = formatErrorContextSuffix(context);
  const isAnthropicMessages = context?.endpointProfile === "anthropic_messages";
  if (status === 400) {
    const hint = sanitizeProviderBadRequestHint(responseText);
    return new LinghunError({
      code: "PROVIDER_BAD_REQUEST",
      message: `模型请求失败：HTTP 400，请求格式不被 provider 接受${suffix}${hint ? `（${hint}）` : "。"}`,
      suggestion: isAnthropicMessages
        ? "请运行 /model doctor；重点检查 model 名是否被网关接受、anthropic Messages schema（messages/system/tool_use/tool_result）、tool_choice、thinking/reasoning 字段、anthropic-version header 是否匹配。"
        : "请运行 /model doctor；重点检查 endpointProfile、compatibilityProfile、model、tools/tool_choice 支持、reasoning/thinking 字段、tool_result 回灌格式和 OpenAI-compatible 网关兼容性。",
      recoverable: true,
    });
  }
  if (status === 404) {
    return new LinghunError({
      code: "PROVIDER_NOT_FOUND",
      message: `模型请求失败：HTTP 404，endpoint 不存在或不被 provider 支持${suffix}。`,
      suggestion: isAnthropicMessages
        ? "请运行 /model doctor；确认 base_url 不含完整 endpoint（例如不要把 /v1/messages 拼到 base_url），网关确实支持 /v1/messages，且 model 名拼写正确。"
        : "请运行 /model doctor；确认 base_url 没有误填完整 endpoint，且网关支持当前 endpointProfile 对应的路径。",
      recoverable: true,
    });
  }
  if (status === 429) {
    if (isQuotaOrBalanceExhaustedResponse(responseText)) {
      return new LinghunError({
        code: "PROVIDER_QUOTA_EXHAUSTED",
        message: `模型请求失败：HTTP 429，provider 返回额度或余额不足${suffix}。`,
        suggestion:
          "请充值或检查账单，或切换可用的 key/provider/model；Linghun 没有查询余额，只是根据上游错误分类。",
        recoverable: true,
      });
    }
    return new LinghunError({
      code: "PROVIDER_RATE_LIMITED",
      message: `模型请求失败：HTTP 429，已触发 provider 限流${suffix}。`,
      suggestion: "请稍后重试、降低请求频率，或运行 /model doctor 检查当前 provider/model 配置。",
      recoverable: true,
    });
  }
  if (status === 402 || (status < 500 && isQuotaOrBalanceExhaustedResponse(responseText))) {
    return new LinghunError({
      code: "PROVIDER_QUOTA_EXHAUSTED",
      message: `模型请求失败：HTTP ${status}，provider 返回额度、余额或账单不可用${suffix}。`,
      suggestion:
        "请充值或检查账单，或切换可用的 key/provider/model；Linghun 没有查询余额，只是根据上游错误分类。",
      recoverable: true,
    });
  }
  if (status >= 500) {
    return new LinghunError({
      code: "PROVIDER_SERVER_ERROR",
      message: `模型请求失败：HTTP ${status}，provider 服务端异常${suffix}。`,
      suggestion:
        providerType === "openai-compatible"
          ? "请稍后重试；如持续失败，运行 /model doctor 检查 provider/baseUrl/model、endpointProfile 是否被网关支持，以及 base_url 是否误填了完整 endpoint。"
          : "请稍后重试；如持续失败，运行 /model doctor 检查 base_url 或切换 fallback model。",
      recoverable: true,
    });
  }
  return new LinghunError({
    code: "PROVIDER_HTTP_ERROR",
    message: `模型请求失败：HTTP ${status}${suffix}。`,
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
