import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import { resolveProviderRuntimeContract } from "@linghun/providers";
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

export function providerRuntimeKey(runtime: Pick<SelectedModelRuntime, "provider" | "model">): string {
  return `${runtime.provider}\u0000${runtime.model}`;
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
  const contract = resolveProviderRuntimeContract(
    { ...providerConfig, id: provider },
    { messages: [], model: fallbackModel },
  );
  const endpointProfile = contract.endpointProfile;
  const reasoningLevel = providerConfig.reasoningLevel;
  const reasoningSent = Boolean(reasoningLevel && contract.sendReasoning);
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
  attemptedRuntimeKeys?: ReadonlySet<string>,
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
    if (attemptedRuntimeKeys?.has(providerRuntimeKey(fallbackRuntime))) continue;
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
    commitGuard?: () => boolean;
  },
): Promise<void> {
  if (input.commitGuard && !input.commitGuard()) return;
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
  if (input.commitGuard && !input.commitGuard()) return;
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
  if (input.commitGuard && !input.commitGuard()) return;
  await context.store.appendEvent(sessionId, {
    type: "system_event",
    id: randomUUID(),
    level: input.status === "succeeded" ? "info" : "warning",
    message: `provider fallback attempt: from ${input.from.provider}/${input.from.model}; to ${input.to.provider}/${input.to.model}; reason ${input.kind}; code ${input.code}; status ${input.status}`,
    createdAt: new Date().toISOString(),
  }, input.commitGuard);
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
