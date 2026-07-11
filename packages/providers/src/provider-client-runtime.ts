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

let registeredFactories: ProviderClientFactories | undefined;

export function registerClientFactories(factories: ProviderClientFactories): void {
  registeredFactories = factories;
}

export function getRegisteredClientFactories(): ProviderClientFactories {
  if (!registeredFactories) {
    throw new Error("provider client factories have not been registered");
  }
  return registeredFactories;
}
