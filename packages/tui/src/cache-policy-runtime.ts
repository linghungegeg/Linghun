import type { EndpointProfile, ModelRequest, ModelUsage } from "@linghun/providers";
import { stableHash } from "./cache-freshness.js";
import type { CompactProjection, PostCompactCacheWarmupState } from "./tui-data-types.js";

const COMPACT_STABLE_MESSAGE_PREFIXES = [
  "Deep compact context",
  "Context compact projection",
] as const;
const POST_COMPACT_WARMUP_TURNS = 2;
const MAIN_CHAIN_CACHE_REQUEST_KINDS = new Set<CacheRequestKind>(["main", "continuation", "final"]);

export type CacheRequestKind =
  | "main"
  | "continuation"
  | "final"
  | "agent-child"
  | "side-question"
  | "deep-compact";

export type CacheWritePolicy = {
  allowWrite: boolean;
  reason: string;
};

export type CachePolicyDecision = {
  kind: CacheRequestKind;
  write: CacheWritePolicy;
};

export type CacheRequestFingerprint = {
  requestHash: string;
  messagePrefixHash: string;
  systemPrefixHash: string;
  conversationPrefixHash: string;
  latestMessageHash: string;
  toolSchemaHash: string;
  stableToolSchemaHash: string;
  dynamicToolSchemaHash: string;
  modelHash: string;
  reasoningHash: string;
  cacheConfigHash: string;
  promptCacheKeyHash: string;
  changedKeys: string[];
};

export type CacheRequestObservation = {
  id: string;
  kind: CacheRequestKind;
  provider: string;
  model: string;
  endpointProfile?: EndpointProfile;
  messageCount: number;
  toolCount: number;
  promptCacheEnabled: boolean;
  promptCacheTtl?: "1h";
  hasCacheBreakNonce: boolean;
  createdAt: string;
  fingerprint: CacheRequestFingerprint;
  usage?: CacheUsageObservation;
};

export type CacheSafePrefixSnapshot = {
  messages: ModelRequest["messages"];
  tools?: ModelRequest["tools"];
  toolChoice?: ModelRequest["toolChoice"];
  endpointProfile?: EndpointProfile;
  reasoningLevel?: string;
  promptCacheEnabled?: boolean;
  promptCacheTtl?: "1h";
  cacheBreakNonce?: string;
  fingerprint: Pick<
    CacheRequestFingerprint,
    | "messagePrefixHash"
    | "systemPrefixHash"
    | "conversationPrefixHash"
    | "stableToolSchemaHash"
    | "modelHash"
    | "reasoningHash"
  >;
};

export type CacheSafePrefixApplyResult =
  | { status: "applied"; request: ModelRequest }
  | { status: "skipped"; request: ModelRequest; reason: string };

export type CacheUsageObservation = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWriteTokensEstimated: boolean;
  cacheCreationEphemeral5mTokens?: number;
  cacheCreationEphemeral1hTokens?: number;
  endpoint?: string;
  source: "api_usage" | "estimated";
};

export function resolveCachePolicy(kind: CacheRequestKind): CachePolicyDecision {
  if (kind === "agent-child" || kind === "side-question" || kind === "deep-compact") {
    return {
      kind,
      write: {
        allowWrite: false,
        reason: "sidechain requests must not create or refresh main-chain prompt cache entries",
      },
    };
  }
  return {
    kind,
    write: {
      allowWrite: true,
      reason: "main-chain request shape may refresh the shared prompt cache prefix",
    },
  };
}

export function applyCacheWritePolicyToRequest(
  request: ModelRequest,
  policy: CachePolicyDecision,
  state?: CacheRequestObservationState,
): ModelRequest {
  if (policy.write.allowWrite) return applyMainChainRequestShapeLatch(request, policy.kind, state);
  if (!request.promptCacheEnabled && !request.promptCacheTtl && !request.cacheBreakNonce)
    return request;
  const next: ModelRequest = { ...request };
  next.promptCacheEnabled = undefined;
  next.promptCacheTtl = undefined;
  next.cacheBreakNonce = undefined;
  return next;
}

type PromptCacheTtlShape = "5m" | "1h";

export type CacheRequestShapeLatch = {
  promptCacheEnabled: boolean;
  promptCacheTtl: PromptCacheTtlShape;
  cacheBreakNonce?: string;
  endpointProfile?: EndpointProfile;
  reasoningLevel?: string;
};

function applyMainChainRequestShapeLatch(
  request: ModelRequest,
  kind: CacheRequestKind,
  state: CacheRequestObservationState | undefined,
): ModelRequest {
  if (!state) return request;
  const latched = state.cacheRequestShapeLatch;
  if (kind === "main" || !latched) {
    state.cacheRequestShapeLatch = createCacheRequestShapeLatch(request);
    return request;
  }
  return applyCacheRequestShapeLatch(request, latched);
}

function createCacheRequestShapeLatch(request: ModelRequest): CacheRequestShapeLatch {
  const promptCacheEnabled = request.promptCacheEnabled === true;
  return {
    promptCacheEnabled,
    promptCacheTtl: request.promptCacheTtl === "1h" ? "1h" : "5m",
    cacheBreakNonce: promptCacheEnabled ? request.cacheBreakNonce : undefined,
    endpointProfile: request.endpointProfile,
    reasoningLevel: request.reasoningLevel,
  };
}

function applyCacheRequestShapeLatch(
  request: ModelRequest,
  latched: CacheRequestShapeLatch,
): ModelRequest {
  const next: ModelRequest = { ...request };
  next.endpointProfile = latched.endpointProfile;
  next.reasoningLevel = latched.reasoningLevel;
  if (!latched.promptCacheEnabled) {
    next.promptCacheEnabled = undefined;
    next.promptCacheTtl = undefined;
    next.cacheBreakNonce = undefined;
    return next;
  }
  next.promptCacheEnabled = true;
  next.promptCacheTtl = latched.promptCacheTtl === "1h" ? "1h" : undefined;
  next.cacheBreakNonce = latched.cacheBreakNonce;
  return next;
}

export function observeCacheSafeRequest(input: {
  previous?: CacheRequestObservation;
  kind: CacheRequestKind;
  provider: string;
  request: ModelRequest;
  now?: Date;
}): CacheRequestObservation {
  const fingerprintWithoutChangedKeys = createCacheRequestFingerprint(input.request);
  const changedKeys = diffCacheRequestFingerprint(
    input.previous?.fingerprint,
    fingerprintWithoutChangedKeys,
  );
  const fingerprint = { ...fingerprintWithoutChangedKeys, changedKeys };
  return {
    id: stableHash({ createdAt: input.now?.toISOString() ?? Date.now(), fingerprint }),
    kind: resolveCachePolicy(input.kind).kind,
    provider: input.provider,
    model: input.request.model ?? "unknown",
    endpointProfile: input.request.endpointProfile,
    messageCount: input.request.messages.length,
    toolCount: input.request.tools?.length ?? 0,
    promptCacheEnabled: input.request.promptCacheEnabled === true,
    promptCacheTtl: input.request.promptCacheTtl,
    hasCacheBreakNonce: Boolean(input.request.cacheBreakNonce),
    createdAt: (input.now ?? new Date()).toISOString(),
    fingerprint,
  };
}

export function observeCacheUsage(input: {
  observation: CacheRequestObservation | undefined;
  usage: ModelUsage;
}): CacheRequestObservation | undefined {
  if (!input.observation) return undefined;
  return {
    ...input.observation,
    usage: normalizeCacheUsageObservation(input.usage),
  };
}

export type CacheRequestObservationState = {
  lastRequestObservation?: CacheRequestObservation;
  lastMainChainRequestObservation?: CacheRequestObservation;
  lastRequestObservationByKind?: Partial<
    Record<CacheRequestObservation["kind"], CacheRequestObservation>
  >;
  cacheRequestShapeLatch?: CacheRequestShapeLatch;
  lastCacheSafePrefix?: CacheSafePrefixSnapshot;
  lastCacheSafePrefixSkipReason?: string;
  postCompactCacheWarmup?: PostCompactCacheWarmupState;
};

export function rememberCacheSafePrefix(
  state: CacheRequestObservationState,
  request: ModelRequest,
): CacheSafePrefixSnapshot {
  const fingerprint = createCacheRequestFingerprint(request);
  const snapshot: CacheSafePrefixSnapshot = {
    messages: request.messages,
    tools: request.tools,
    toolChoice: request.toolChoice,
    endpointProfile: request.endpointProfile,
    reasoningLevel: request.reasoningLevel,
    promptCacheEnabled: request.promptCacheEnabled,
    promptCacheTtl: request.promptCacheTtl,
    cacheBreakNonce: request.cacheBreakNonce,
    fingerprint: {
      messagePrefixHash: fingerprint.messagePrefixHash,
      systemPrefixHash: fingerprint.systemPrefixHash,
      conversationPrefixHash: fingerprint.conversationPrefixHash,
      stableToolSchemaHash: fingerprint.stableToolSchemaHash,
      modelHash: fingerprint.modelHash,
      reasoningHash: fingerprint.reasoningHash,
    },
  };
  state.lastCacheSafePrefix = snapshot;
  state.lastCacheSafePrefixSkipReason = undefined;
  return snapshot;
}

export function applyLastCacheSafePrefix(input: {
  state: CacheRequestObservationState;
  request: ModelRequest;
  inheritMessages?: boolean;
  inheritSystemPrefix?: boolean;
  inheritTools?: boolean;
}): CacheSafePrefixApplyResult {
  const snapshot = input.state.lastCacheSafePrefix;
  if (!snapshot) return cacheSafePrefixSkipped(input.state, input.request, "no parent cache-safe prefix");
  const next: ModelRequest = {
    ...input.request,
    endpointProfile: snapshot.endpointProfile,
    reasoningLevel: snapshot.reasoningLevel,
    promptCacheEnabled: snapshot.promptCacheEnabled,
    promptCacheTtl: snapshot.promptCacheTtl,
    cacheBreakNonce: snapshot.cacheBreakNonce,
  };
  if (input.inheritMessages) {
    const latest = input.request.messages.at(-1);
    if (!latest || latest.role === "tool") {
      return cacheSafePrefixSkipped(
        input.state,
        input.request,
        "request has no safe latest user/assistant message",
      );
    }
    next.messages = [...snapshot.messages, latest];
  } else if (input.inheritSystemPrefix) {
    const parentSystemPrefix = snapshot.messages.filter((message) => message.role === "system");
    if (parentSystemPrefix.length === 0) {
      return cacheSafePrefixSkipped(input.state, input.request, "parent prefix has no stable system messages");
    }
    next.messages = [...parentSystemPrefix, ...input.request.messages];
  }
  if (input.inheritTools) {
    const requestedTools = normalizeToolSchema(input.request.tools ?? []);
    const parentTools = normalizeToolSchema(snapshot.tools ?? []);
    if (stableHash(requestedTools) !== stableHash(parentTools)) {
      return cacheSafePrefixSkipped(input.state, input.request, "tool schema differs from parent prefix");
    }
    next.tools = snapshot.tools;
    next.toolChoice = snapshot.toolChoice ?? input.request.toolChoice;
  }
  input.state.lastCacheSafePrefixSkipReason = undefined;
  return { status: "applied", request: next };
}

export function applyPostCompactMainChainCacheSafePrefix(input: {
  state: CacheRequestObservationState;
  request: ModelRequest;
}): CacheSafePrefixApplyResult {
  const warmup = input.state.postCompactCacheWarmup;
  if (!warmup || warmup.status !== "warming" || warmup.remainingTurns <= 0) {
    return cacheSafePrefixSkipped(input.state, input.request, "post-compact warmup is not active");
  }
  const snapshot = input.state.lastCacheSafePrefix;
  if (!snapshot) return cacheSafePrefixSkipped(input.state, input.request, "no parent cache-safe prefix");

  const parentCompactStableMessages = collectCompactStableConversationPrefix(
    snapshot.messages.filter((message) => message.role !== "system"),
  );
  if (parentCompactStableMessages.length === 0) {
    return cacheSafePrefixSkipped(
      input.state,
      input.request,
      "parent prefix has no compact stable messages",
    );
  }
  const requestCompactStableMessages = collectCompactStableConversationPrefix(
    input.request.messages.filter((message) => message.role !== "system"),
  );
  if (
    requestCompactStableMessages.length > 0 &&
    stableHash(requestCompactStableMessages) !== stableHash(parentCompactStableMessages)
  ) {
    return cacheSafePrefixSkipped(input.state, input.request, "compact stable prefix differs from parent");
  }
  const nextDynamicMessages = collectCurrentMainChainDynamicTail(input.request.messages);
  if (nextDynamicMessages.length === 0) {
    return cacheSafePrefixSkipped(
      input.state,
      input.request,
      "request has no safe current main-chain tail",
    );
  }
  const requestedToolBoundary = splitToolSchemaBoundary(normalizeToolSchema(input.request.tools ?? []));
  const parentToolBoundary = splitToolSchemaBoundary(normalizeToolSchema(snapshot.tools ?? []));
  if (stableHash(requestedToolBoundary.stable) !== stableHash(parentToolBoundary.stable)) {
    return cacheSafePrefixSkipped(input.state, input.request, "stable tool schema differs from parent prefix");
  }

  const currentSystemMessages = input.request.messages.filter((message) => message.role === "system");
  const next: ModelRequest = {
    ...input.request,
    messages: [...currentSystemMessages, ...parentCompactStableMessages, ...nextDynamicMessages],
  };
  input.state.lastCacheSafePrefixSkipReason = undefined;
  return { status: "applied", request: next };
}


function collectCurrentMainChainDynamicTail(
  messages: ModelRequest["messages"],
): ModelRequest["messages"] {
  const conversation = messages.filter((message) => message.role !== "system");
  const compactStablePrefixLength = collectCompactStableConversationPrefix(conversation).length;
  const tail = conversation.slice(compactStablePrefixLength);
  if (tail.some((message) => message.role === "tool")) return [];
  return tail;
}

function cacheSafePrefixSkipped(
  state: CacheRequestObservationState,
  request: ModelRequest,
  reason: string,
): CacheSafePrefixApplyResult {
  state.lastCacheSafePrefixSkipReason = reason;
  return { status: "skipped", request, reason };
}

export function recordCacheRequestObservation(
  state: CacheRequestObservationState,
  kind: CacheRequestKind,
  provider: string,
  request: ModelRequest,
): CacheRequestObservation {
  const policyKind = resolveCachePolicy(kind).kind;
  const previous = MAIN_CHAIN_CACHE_REQUEST_KINDS.has(policyKind)
    ? state.lastMainChainRequestObservation
    : state.lastRequestObservationByKind?.[policyKind];
  const observation = observeCacheSafeRequest({
    previous,
    kind: policyKind,
    provider,
    request,
  });
  state.lastRequestObservation = observation;
  if (MAIN_CHAIN_CACHE_REQUEST_KINDS.has(observation.kind)) {
    state.lastMainChainRequestObservation = observation;
  }
  state.lastRequestObservationByKind = {
    ...state.lastRequestObservationByKind,
    [policyKind]: observation,
  };
  updatePostCompactCacheWarmup(state, observation);
  return observation;
}

export function recordCacheUsageObservation(
  state: CacheRequestObservationState,
  usage: ModelUsage,
  kind?: CacheRequestKind,
): CacheRequestObservation | undefined {
  const policyKind = kind ? resolveCachePolicy(kind).kind : undefined;
  const target = policyKind
    ? state.lastRequestObservationByKind?.[policyKind]
    : state.lastRequestObservation;
  const updated = observeCacheUsage({ observation: target, usage });
  if (!updated) return undefined;
  if (!kind || state.lastRequestObservation?.id === updated.id) {
    state.lastRequestObservation = updated;
  }
  if (
    MAIN_CHAIN_CACHE_REQUEST_KINDS.has(updated.kind) &&
    state.lastMainChainRequestObservation?.id === updated.id
  ) {
    state.lastMainChainRequestObservation = updated;
  }
  state.lastRequestObservationByKind = {
    ...state.lastRequestObservationByKind,
    [updated.kind]: updated,
  };
  return updated;
}

export function createPostCompactCacheWarmup(input: {
  projection: CompactProjection;
  baseline?: CacheRequestObservation;
  now?: Date;
  totalTurns?: number;
}): PostCompactCacheWarmupState {
  const now = input.now ?? new Date();
  return {
    compactId: input.projection.boundaryId,
    summaryHash: stableHash(input.projection.summary),
    projectionHash: stableHash({
      boundaryId: input.projection.boundaryId,
      summary: input.projection.summary,
      restoreContext: input.projection.restoreContext,
      replacementKind: input.projection.replacementKind,
      replacementMessageCount: input.projection.replacementMessageCount,
      postCompactChars: input.projection.postCompactChars,
    }),
    baselinePrefixHash: input.baseline?.fingerprint.messagePrefixHash,
    baselineConversationPrefixHash: input.baseline?.fingerprint.conversationPrefixHash,
    remainingTurns: input.totalTurns ?? POST_COMPACT_WARMUP_TURNS,
    totalTurns: input.totalTurns ?? POST_COMPACT_WARMUP_TURNS,
    status: "warming",
    lastChangedKeys: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function updatePostCompactCacheWarmup(
  state: CacheRequestObservationState,
  observation: CacheRequestObservation,
): void {
  const warmup = state.postCompactCacheWarmup;
  if (!warmup || !MAIN_CHAIN_CACHE_REQUEST_KINDS.has(observation.kind)) return;

  warmup.baselinePrefixHash ??= observation.fingerprint.messagePrefixHash;
  warmup.baselineConversationPrefixHash ??= observation.fingerprint.conversationPrefixHash;
  warmup.lastChangedKeys = observation.fingerprint.changedKeys;
  warmup.updatedAt = observation.createdAt;
  if (warmup.remainingTurns > 0) {
    warmup.remainingTurns -= 1;
  }
  if (warmup.remainingTurns <= 0) {
    warmup.remainingTurns = 0;
    warmup.status = "complete";
  }
}

export function normalizeCacheUsageObservation(usage: ModelUsage): CacheUsageObservation {
  return {
    inputTokens: Math.max(0, usage.inputTokens),
    outputTokens: Math.max(0, usage.outputTokens),
    totalTokens: Math.max(0, usage.totalTokens),
    cacheReadTokens: Math.max(0, usage.cacheReadTokens ?? 0),
    cacheWriteTokens: Math.max(0, usage.cacheWriteTokens ?? 0),
    cacheWriteTokensEstimated: usage.cacheWriteTokensEstimated === true,
    cacheCreationEphemeral5mTokens: usage.cacheCreationEphemeral5mTokens,
    cacheCreationEphemeral1hTokens: usage.cacheCreationEphemeral1hTokens,
    endpoint: usage.endpoint,
    source:
      usage.cacheReadTokens === undefined && usage.cacheWriteTokens === undefined
        ? "estimated"
        : "api_usage",
  };
}

function createCacheRequestFingerprint(
  request: ModelRequest,
): Omit<CacheRequestFingerprint, "changedKeys"> {
  const toolSchema = normalizeToolSchema(request.tools ?? []);
  const toolBoundary = splitToolSchemaBoundary(toolSchema);
  const cacheConfig = {
    promptCacheEnabled: request.promptCacheEnabled === true,
    promptCacheTtl: request.promptCacheTtl ?? "5m",
    hasCacheBreakNonce: Boolean(request.cacheBreakNonce),
    hasPromptCacheKey: Boolean(request.promptCacheKey),
    promptCacheKeyHash: request.promptCacheKey ? stableHash(request.promptCacheKey) : "none",
  };
  const modelShape = {
    model: request.model ?? "unknown",
    endpointProfile: request.endpointProfile ?? "default",
    toolChoice: request.toolChoice ?? "default",
    parallelToolCalls: request.parallelToolCalls ?? "default",
  };
  const reasoningShape = {
    reasoningLevel: request.reasoningLevel ?? "default",
  };
  const messageBoundary = splitCacheMessageBoundary(request.messages);
  return {
    requestHash: stableHash({
      messages: request.messages,
      toolSchema,
      modelShape,
      reasoningShape,
      cacheConfig,
    }),
    messagePrefixHash: stableHash({
      system: messageBoundary.systemPrefix,
      conversationPrefix: messageBoundary.conversationPrefix,
    }),
    systemPrefixHash: stableHash(messageBoundary.systemPrefix),
    conversationPrefixHash: stableHash(messageBoundary.conversationPrefix),
    latestMessageHash: stableHash(messageBoundary.latestMessage ?? null),
    toolSchemaHash: stableHash(toolSchema),
    stableToolSchemaHash: stableHash(toolBoundary.stable),
    dynamicToolSchemaHash: stableHash(toolBoundary.dynamic),
    modelHash: stableHash(modelShape),
    reasoningHash: stableHash(reasoningShape),
    cacheConfigHash: stableHash(cacheConfig),
    promptCacheKeyHash: cacheConfig.promptCacheKeyHash,
  };
}

function normalizeToolSchema(tools: NonNullable<ModelRequest["tools"]>): Array<{
  name: string;
  source: string;
  schemaHash: string;
}> {
  return tools
    .map((tool) => {
      const source = resolveToolSource(tool);
      return {
        name: tool.name,
        source,
        schemaHash:
          tool.schemaHash ??
          stableHash({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            source,
          }),
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.source.localeCompare(b.source) ||
        a.schemaHash.localeCompare(b.schemaHash),
    );
}

function splitToolSchemaBoundary(
  tools: ReturnType<typeof normalizeToolSchema>,
): { stable: ReturnType<typeof normalizeToolSchema>; dynamic: ReturnType<typeof normalizeToolSchema> } {
  const stable = tools.filter((tool) => !isDynamicToolSource(tool.source));
  const dynamic = tools.filter((tool) => isDynamicToolSource(tool.source));
  return { stable, dynamic };
}

function resolveToolSource(tool: NonNullable<ModelRequest["tools"]>[number]): string {
  if (tool.source) return tool.source;
  if (tool.name.startsWith("mcp__")) return "mcp";
  if (tool.name.startsWith("skill__")) return "skill";
  if (tool.name.startsWith("plugin__")) return "plugin";
  return "unknown";
}

function isDynamicToolSource(source: string): boolean {
  return source === "mcp" || source === "skill" || source === "plugin";
}

function splitCacheMessageBoundary(messages: ModelRequest["messages"]): {
  systemPrefix: ModelRequest["messages"];
  conversationPrefix: ModelRequest["messages"];
  latestMessage: ModelRequest["messages"][number] | undefined;
} {
  const systemMessages = messages.filter((message) => message.role === "system");
  const conversation = messages.filter((message) => message.role !== "system");
  const compactStablePrefix = collectCompactStableConversationPrefix(conversation);
  return {
    systemPrefix: selectCacheableSystemPrefix(systemMessages),
    conversationPrefix:
      compactStablePrefix.length > 0 ? compactStablePrefix : conversation.slice(0, -1),
    latestMessage: conversation.at(-1),
  };
}

function selectCacheableSystemPrefix(
  systemMessages: ModelRequest["messages"],
): ModelRequest["messages"] {
  if (systemMessages.length <= 1) return systemMessages;
  const hasExplicitHints = systemMessages.some(
    (message) => "promptCache" in message && message.promptCache !== undefined,
  );
  if (!hasExplicitHints) return systemMessages.slice(0, 1);
  for (let index = systemMessages.length - 1; index >= 0; index -= 1) {
    const message = systemMessages[index];
    if (message && "promptCache" in message && message.promptCache === "cacheable") {
      return systemMessages.slice(0, index + 1);
    }
  }
  return [];
}

function collectCompactStableConversationPrefix(
  conversation: ModelRequest["messages"],
): ModelRequest["messages"] {
  const prefix: ModelRequest["messages"] = [];
  for (const message of conversation) {
    if (!isCompactStableMessage(message)) break;
    prefix.push(message);
  }
  return prefix;
}

function isCompactStableMessage(message: ModelRequest["messages"][number]): boolean {
  return message.role === "user" && startsWithCompactStablePrefix(message.content);
}

function startsWithCompactStablePrefix(content: ModelRequest["messages"][number]["content"]): boolean {
  return (
    typeof content === "string" &&
    COMPACT_STABLE_MESSAGE_PREFIXES.some((prefix) => content.startsWith(prefix))
  );
}

function diffCacheRequestFingerprint(
  previous: CacheRequestFingerprint | undefined,
  current: Omit<CacheRequestFingerprint, "changedKeys">,
): string[] {
  if (!previous) return [];
  const keys: Array<keyof Omit<CacheRequestFingerprint, "changedKeys">> = [
    "requestHash",
    "messagePrefixHash",
    "systemPrefixHash",
    "conversationPrefixHash",
    "latestMessageHash",
    "toolSchemaHash",
    "stableToolSchemaHash",
    "dynamicToolSchemaHash",
    "modelHash",
    "reasoningHash",
    "cacheConfigHash",
    "promptCacheKeyHash",
  ];
  return keys.filter((key) => previous[key] !== current[key]);
}
