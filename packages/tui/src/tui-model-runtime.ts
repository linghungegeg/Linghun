// Module 6: tui-model-runtime
// Pure model role / route / runtime helpers extracted from
// packages/tui/src/index.ts as part of the D.13 mechanical split.
// Behavior is unchanged. Coordinators that depend on i18n (`t`),
// writeLine/writeStatus/writeLightHints, providerEnv mutation, model setup
// dialog state machine and snapshotDeferredToolsSummary stay in index.ts to
// avoid cross-module circular dependencies (Path A safety valve #2).
//
// What moved here:
//   - SelectedModelRuntime type
//   - MAX_ROUTE_DECISIONS constant (module-private mirror)
//   - shouldOfferUserScopedModelSetup
//   - getStartupProjectRouteProblem
//   - readProjectExecutorRouteOverride
//   - getProjectModelRouteProblem
//   - getProjectModelRouteProblemForRoute
//   - hasSelectedProviderConfigProblem
//   - getRuntimeStatusProvider
//   - getActiveEndpointProfileLabel
//   - resolveInitialModel
//   - getSelectedModelRuntime
//   - formatReasoningEffectiveState
//   - resolveProviderForModel
//   - createModelGateway
//   - resolveRoleRoute
//   - createRouteRepairSuggestions
//   - formatRoutePauseMessage
//
// All consumers continue to import via "../index.js"; index.ts re-exports
// the symbols below and imports them value-side for internal callers.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  type LinghunConfig,
  type ModelRole,
  type RoleModelRoute,
  getProjectSettingsPath,
} from "@linghun/config";
import {
  DeepSeekProvider,
  type EndpointProfile,
  ModelGateway,
  OpenAiCompatibleProvider,
  resolveEffectiveEndpointProfile,
} from "@linghun/providers";
import { normalizeDeepSeekModelName } from "@linghun/shared";
import type { TuiContext } from "./index.js";
import {
  diagnoseConcreteRoute,
  getRoleRoute,
  getRouteBlockingProblems,
  hasOpenAiCompatibleProviderSetupProblem,
  inferProviderForRouteModel,
  isDefaultExecutorRoute,
} from "./model-doctor-runtime.js";
import type { ResolvedRoleRoute, RoleRouteDecision } from "./tui-data-types.js";

// MAX_ROUTE_DECISIONS lives in index.ts; module-private mirror keeps
// resolveRoleRoute self-contained while preserving the slice cap behavior.
const MAX_ROUTE_DECISIONS = 50;

export type SelectedModelRuntime = {
  role: ModelRole;
  provider: string;
  model: string;
  endpointProfile: EndpointProfile;
  reasoningLevel?: string;
  reasoningStatus: string;
  reasoningSent: boolean;
};

export function shouldOfferUserScopedModelSetup(context: TuiContext): boolean {
  return !getProjectModelRouteProblem(context) && hasSelectedProviderConfigProblem(context);
}

export async function getStartupProjectRouteProblem(
  context: TuiContext,
): Promise<string | undefined> {
  const projectRoute = await readProjectExecutorRouteOverride(context.projectPath);
  if (projectRoute) {
    return getProjectModelRouteProblemForRoute(projectRoute, context);
  }
  return getProjectModelRouteProblem(context);
}

export async function readProjectExecutorRouteOverride(
  projectPath: string,
): Promise<RoleModelRoute | undefined> {
  try {
    const parsed = JSON.parse(await readFile(getProjectSettingsPath(projectPath), "utf8")) as {
      modelRoutes?: { routes?: RoleModelRoute[] };
    };
    return parsed.modelRoutes?.routes?.find((route) => route.role === "executor");
  } catch {
    return undefined;
  }
}

export function getProjectModelRouteProblem(context: TuiContext): string | undefined {
  const route = getRoleRoute(context.config, "executor");
  if (isDefaultExecutorRoute(route, context.config)) return undefined;
  return getProjectModelRouteProblemForRoute(route, context);
}

export function getProjectModelRouteProblemForRoute(
  route: RoleModelRoute,
  context: TuiContext,
): string | undefined {
  const providerId = route.provider || resolveProviderForModel(context.config, route.primaryModel);
  const provider = context.config.providers[providerId];
  if (!provider) {
    return `executor route points to provider=${providerId || "unknown"}, but that provider is not configured`;
  }
  if (provider.type === "openai-compatible" && hasOpenAiCompatibleProviderSetupProblem(provider)) {
    return undefined;
  }
  if (!route.primaryModel || route.primaryModel === "openai-compatible-model") {
    return `executor route primaryModel=${route.primaryModel || "missing"} is not a concrete model`;
  }
  return undefined;
}

export function hasSelectedProviderConfigProblem(context: TuiContext): boolean {
  const runtime = getSelectedModelRuntime(context);
  const provider = context.config.providers[runtime.provider];
  if (!provider) return true;
  if (provider.type !== "openai-compatible") return !provider.apiKey || !provider.model;
  return hasOpenAiCompatibleProviderSetupProblem(provider);
}

export function getRuntimeStatusProvider(context: TuiContext): string {
  const runtime = getSelectedModelRuntime(context);
  return runtime.provider;
}

// D.13F：返回当前 executor runtime 的 effective endpoint profile，用于 cache-freshness 维度。
// 必须用 resolveEffectiveEndpointProfile 得到的 effective profile（而非 provider 配置原值），
// 否则 Claude + chat_completions placeholder 时 hash 会被误算成 chat_completions，
// 与真实请求的 anthropic_messages 不一致，破坏 /break-cache status 的诊断价值。
export function getActiveEndpointProfileLabel(context: TuiContext): string {
  const runtime = getSelectedModelRuntime(context);
  const provider = context.config.providers[runtime.provider];
  const decision = resolveEffectiveEndpointProfile({
    requestEndpointProfile: undefined,
    configEndpointProfile: provider?.endpointProfile,
    configBaseUrl: provider?.baseUrl,
    configModel: provider?.model,
    requestModel: runtime.model,
  });
  return decision.endpointProfile;
}

export function resolveInitialModel(config: LinghunConfig): string {
  const executor = config.modelRoutes.routes.find((route) => route.role === "executor");
  if (executor && !isDefaultExecutorRoute(executor, config) && executor.primaryModel) {
    return executor.primaryModel;
  }
  return config.defaultModel || executor?.primaryModel || resolveFirstProviderModel(config);
}

export function getSelectedModelRuntime(
  context: TuiContext,
  role: ModelRole = "executor",
): SelectedModelRuntime {
  const route = getRoleRoute(context.config, role);
  const useContextModel =
    role === "executor" &&
    isDefaultExecutorRoute(route, context.config) &&
    context.model &&
    context.model !== route.primaryModel;
  const model = useContextModel ? context.model : route.primaryModel || context.model;
  const provider = useContextModel
    ? resolveProviderForModel(context.config, model)
    : route.provider || resolveProviderForModel(context.config, model);
  const providerConfig = context.config.providers[provider];
  const rawEndpointProfile = providerConfig?.endpointProfile ?? "chat_completions";
  const endpointProfile = resolveEffectiveEndpointProfile({
    requestEndpointProfile: undefined,
    configEndpointProfile: rawEndpointProfile,
    configBaseUrl: providerConfig?.baseUrl,
    configModel: providerConfig?.model,
    requestModel: model,
  }).endpointProfile;
  const compatibilityProfile =
    providerConfig?.compatibilityProfile ??
    (providerConfig?.type === "deepseek" ? "deepseek" : "strict_openai_compatible");
  const reasoningLevel = providerConfig?.reasoningLevel;
  // D.13K：reasoningSent 现支持三种生效路径——
  //   1. responses profile（OpenAI Responses API 原生 reasoning.effort）；
  //   2. permissive_openai_compatible chat（中转网关接受非标 reasoning 字段）；
  //   3. anthropic_messages profile（Anthropic extended thinking，由 provider builder 注入 thinking 字段）。
  const reasoningSent = Boolean(
    reasoningLevel &&
      (endpointProfile === "responses" ||
        compatibilityProfile === "permissive_openai_compatible" ||
        endpointProfile === "anthropic_messages"),
  );
  return {
    role,
    provider,
    model,
    endpointProfile,
    reasoningLevel,
    reasoningStatus: formatReasoningEffectiveState(reasoningLevel, reasoningSent),
    reasoningSent,
  };
}

export function formatReasoningEffectiveState(
  reasoningLevel: string | undefined,
  reasoningSent: boolean,
): string {
  if (!reasoningLevel) {
    return "未生效";
  }
  return reasoningSent ? `effective/sent ${reasoningLevel}` : "ignored/unsupported/未生效";
}

export function resolveProviderForModel(config: LinghunConfig, model: string): string {
  const normalized = normalizeDeepSeekModelName(model);
  const executor = config.modelRoutes.routes.find((route) => route.role === "executor");
  if (
    (executor?.primaryModel === model || executor?.primaryModel === normalized) &&
    executor.provider
  ) {
    return executor.provider;
  }
  if (config.defaultModel === model || config.defaultModel === normalized) {
    for (const [providerId, provider] of Object.entries(config.providers)) {
      if (provider.model === model || provider.model === normalized) return providerId;
    }
  }
  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (provider.model === model || provider.model === normalized) {
      return providerId;
    }
  }
  return "unknown";
}

function resolveFirstProviderModel(config: LinghunConfig): string {
  for (const provider of Object.values(config.providers)) {
    if (provider.model) return provider.model;
  }
  return "unknown";
}

export function createModelGateway(config: LinghunConfig): ModelGateway {
  return new ModelGateway(
    Object.entries(config.providers).map(([id, provider]) => {
      if (provider.type === "deepseek") {
        return new DeepSeekProvider({ ...provider, id, displayName: "DeepSeek" });
      }
      return new OpenAiCompatibleProvider({ ...provider, id, displayName: "OpenAI compatible" });
    }),
  );
}

export function resolveRoleRoute(
  context: TuiContext,
  role: ModelRole,
  triggerReason: string,
): ResolvedRoleRoute {
  const baseRoute = getRoleRoute(context.config, role);
  const primaryProblems = diagnoseConcreteRoute(
    baseRoute,
    baseRoute.primaryModel,
    baseRoute.provider,
    context.config,
  );
  const primaryBlocking = getRouteBlockingProblems(primaryProblems);
  let selectedProvider = baseRoute.provider;
  let selectedModel = baseRoute.primaryModel;
  let stopConditions = primaryBlocking;
  let fallbackUsed = false;

  if (primaryBlocking.length > 0) {
    for (const fallbackModel of baseRoute.fallbackModels) {
      const fallbackProvider = inferProviderForRouteModel(fallbackModel, context.config);
      const fallbackProblems = diagnoseConcreteRoute(
        baseRoute,
        fallbackModel,
        fallbackProvider,
        context.config,
      );
      const fallbackBlocking = getRouteBlockingProblems(fallbackProblems);
      if (fallbackBlocking.length === 0) {
        selectedProvider = fallbackProvider;
        selectedModel = fallbackModel;
        stopConditions = [];
        fallbackUsed = true;
        break;
      }
    }
  } else {
    stopConditions = [];
  }

  const resolvedRoute = { ...baseRoute, provider: selectedProvider, primaryModel: selectedModel };
  const repairSuggestions = createRouteRepairSuggestions(role, stopConditions, baseRoute);
  const decision: RoleRouteDecision = {
    id: `route-${randomUUID().slice(0, 8)}`,
    triggerReason,
    role,
    selectedProvider: stopConditions.length > 0 ? "" : selectedProvider,
    selectedModel: stopConditions.length > 0 ? "" : selectedModel,
    fallbackCandidates: baseRoute.fallbackModels,
    requiredCapabilities: baseRoute.requiredCapabilities,
    maxCostCny: baseRoute.maxCostCny,
    stopConditions,
    repairSuggestions,
    fallbackUsed,
    budgetStop: false,
    createdAt: new Date().toISOString(),
  };
  context.routeDecisions.unshift(decision);
  context.routeDecisions = context.routeDecisions.slice(0, MAX_ROUTE_DECISIONS);
  return { route: resolvedRoute, decision, usable: stopConditions.length === 0 };
}

export function createRouteRepairSuggestions(
  role: ModelRole,
  stopConditions: string[],
  route: RoleModelRoute,
): string[] {
  if (stopConditions.length === 0) {
    return [];
  }
  const suggestions = [`运行 /model route set ${role} <model> 设置可用模型`];
  if (stopConditions.some((item) => item.includes("openai-compatible"))) {
    suggestions.push(
      "在 .linghun/settings.json 配置 openai-compatible 的 baseUrl、apiKey 和 model",
    );
  }
  if (stopConditions.some((item) => item.startsWith("能力不足"))) {
    suggestions.push(`选择满足 ${route.requiredCapabilities.join("+")} capability 的模型`);
  }
  if (route.fallbackModels.length === 0) {
    suggestions.push("为该 role 配置 fallbackModels，避免 primary 不可用时直接暂停");
  }
  return suggestions;
}

export function formatRoutePauseMessage(role: ModelRole, decision: RoleRouteDecision): string {
  return `${role} role 路由暂停：${decision.stopConditions.join("；")}。修复建议：${decision.repairSuggestions.join("；")}。不会假装可用。`;
}
