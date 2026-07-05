import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import { resolveEffectiveEndpointProfile } from "@linghun/providers";
import { getRoleRoute, inferProviderForRouteModel } from "./model-doctor-runtime.js";
import { checkProviderCooldown, formatCooldownMessage } from "./provider-circuit-breaker.js";
import {
  type ProviderFailureKind,
  classifyProviderFailure,
  formatProviderFallbackAttemptSummary,
} from "./request-lifecycle-presenter.js";
import { writeLine } from "./startup-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { type SelectedModelRuntime, formatReasoningEffectiveState } from "./tui-model-runtime.js";

function getProviderErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "PROVIDER_ERROR";
}

function shouldAttemptRuntimeFallback(kind: ProviderFailureKind): boolean {
  return (
    kind === "rate_limit" ||
    kind === "quota_or_balance_exhausted" ||
    kind === "gateway" ||
    kind === "transit" ||
    kind === "timeout"
  );
}

function createRuntimeForFallbackModel(
  context: TuiContext,
  baseRuntime: SelectedModelRuntime,
  fallbackModel: string,
): SelectedModelRuntime | undefined {
  if (!fallbackModel || fallbackModel === baseRuntime.model) return undefined;
  const provider = inferProviderForRouteModel(fallbackModel, context.config);
  const providerConfig = context.config.providers[provider];
  if (!providerConfig) return undefined;
  const rawEndpointProfile = providerConfig.endpointProfile ?? "chat_completions";
  const endpointProfile = resolveEffectiveEndpointProfile({
    requestEndpointProfile: undefined,
    configEndpointProfile: rawEndpointProfile,
    configBaseUrl: providerConfig.baseUrl,
    configModel: providerConfig.model,
    requestModel: fallbackModel,
  }).endpointProfile;
  const compatibilityProfile =
    providerConfig.compatibilityProfile ??
    (providerConfig.type === "deepseek" ? "deepseek" : "strict_openai_compatible");
  const reasoningLevel = providerConfig.reasoningLevel;
  const reasoningSent = Boolean(
    reasoningLevel &&
      (endpointProfile === "responses" ||
        compatibilityProfile === "permissive_openai_compatible" ||
        endpointProfile === "anthropic_messages"),
  );
  return {
    role: baseRuntime.role,
    provider,
    model: fallbackModel,
    endpointProfile,
    reasoningLevel,
    reasoningStatus: formatReasoningEffectiveState(reasoningLevel, reasoningSent),
    reasoningSent,
  };
}

export function resolveRuntimeFallback(
  context: TuiContext,
  runtime: SelectedModelRuntime,
  error: unknown,
): { runtime: SelectedModelRuntime; kind: ProviderFailureKind; code: string } | undefined {
  const kind = classifyProviderFailure(error);
  if (!shouldAttemptRuntimeFallback(kind)) return undefined;
  const route = getRoleRoute(context.config, runtime.role);
  for (const fallbackModel of route.fallbackModels) {
    const fallbackRuntime = createRuntimeForFallbackModel(context, runtime, fallbackModel);
    if (!fallbackRuntime) continue;
    if (fallbackRuntime.provider === runtime.provider && fallbackRuntime.model === runtime.model) {
      continue;
    }
    return { runtime: fallbackRuntime, kind, code: getProviderErrorCode(error) };
  }
  return undefined;
}

export async function recordProviderFallbackAttempt(
  context: TuiContext,
  sessionId: string,
  input: {
    from: SelectedModelRuntime;
    to: SelectedModelRuntime;
    kind: ProviderFailureKind;
    code: string;
    status: "attempted" | "succeeded" | "failed";
  },
): Promise<void> {
  const summary = formatProviderFallbackAttemptSummary(
    {
      fromProvider: input.from.provider,
      fromModel: input.from.model,
      toProvider: input.to.provider,
      toModel: input.to.model,
      reasonKind: input.kind,
    },
    context.language,
  );
  context.lastProviderFallbackAttempt = {
    fromProvider: input.from.provider,
    fromModel: input.from.model,
    toProvider: input.to.provider,
    toModel: input.to.model,
    reasonKind: input.kind,
    reasonCode: input.code,
    status: input.status,
    summary,
    createdAt: new Date().toISOString(),
  };
  const decision = context.routeDecisions.find(
    (item) => item.role === input.from.role && item.selectedModel === input.from.model,
  );
  if (decision) {
    decision.fallbackUsed = true;
  } else {
    context.routeDecisions.unshift({
      id: `route-${randomUUID().slice(0, 8)}`,
      triggerReason: "provider runtime fallback",
      role: input.from.role,
      selectedProvider: input.to.provider,
      selectedModel: input.to.model,
      fallbackCandidates: [input.to.model],
      requiredCapabilities: [],
      stopConditions: [],
      repairSuggestions: [],
      fallbackUsed: true,
      budgetStop: false,
      createdAt: new Date().toISOString(),
    });
  }
  await context.store.appendEvent(sessionId, {
    type: "system_event",
    id: randomUUID(),
    level: input.status === "succeeded" ? "info" : "warning",
    message: `provider fallback attempt: from ${input.from.provider}/${input.from.model}; to ${input.to.provider}/${input.to.model}; reason ${input.kind}; code ${input.code}; status ${input.status}`,
    createdAt: new Date().toISOString(),
  });
}

export function checkAndWriteProviderCooldown(
  context: TuiContext,
  runtime: SelectedModelRuntime,
  output: Writable,
): boolean {
  const cooldownCheck = checkProviderCooldown(
    context.providerBreaker,
    runtime.provider,
    runtime.model,
  );
  if (!cooldownCheck.blocked) return false;
  writeLine(
    output,
    formatCooldownMessage(
      runtime.provider,
      runtime.model,
      cooldownCheck.remainingMs,
      context.language,
      cooldownCheck.reasonCode,
    ),
  );
  return true;
}
