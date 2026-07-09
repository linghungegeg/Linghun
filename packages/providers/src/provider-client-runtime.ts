import type {
  AnthropicMessagesRequest,
  ModelRequest,
  OpenAiChatRequest,
  OpenAiResponsesRequest,
  ProviderConfig,
  ProviderRuntimeContract,
} from "./index.js";

export type ProviderClientFactoryContext = {
  config: ProviderConfig;
  request: ModelRequest;
  contract: ProviderRuntimeContract;
};

export type ProviderClientFactories = {
  chat: (context: ProviderClientFactoryContext) => OpenAiChatRequest;
  responses: (context: ProviderClientFactoryContext) => OpenAiResponsesRequest;
  anthropicMessages: (context: ProviderClientFactoryContext) => AnthropicMessagesRequest;
};

export type ProviderClientHooks = {
  beforeRequest?: (context: ProviderClientFactoryContext & { url: string }) => void | Promise<void>;
  afterFallback?: (context: ProviderClientFactoryContext & { reason: string }) => void | Promise<void>;
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    statusCode: number;
    requestContext?: "foreground" | "agent";
    requestContextId?: string;
    sessionId?: string;
  }) => void;
};

let registeredFactories: ProviderClientFactories | undefined;
let registeredHooks: ProviderClientHooks = {};

export function registerClientFactories(factories: ProviderClientFactories): void {
  registeredFactories = factories;
}

export function getRegisteredClientFactories(): ProviderClientFactories {
  if (!registeredFactories) {
    throw new Error("provider client factories have not been registered");
  }
  return registeredFactories;
}

export function registerHooks(hooks: ProviderClientHooks): void {
  registeredHooks = { ...registeredHooks, ...hooks };
}

export function getRegisteredHooks(): ProviderClientHooks {
  return registeredHooks;
}
