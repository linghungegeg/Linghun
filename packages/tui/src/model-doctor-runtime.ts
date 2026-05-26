/**
 * Model route doctor and provider diagnostic helpers.
 * Extracted from index.ts (Slice D.10E) — behavior-preserving move only.
 *
 * Key safety invariant: raw API keys are NEVER output; only masked/present/missing/source.
 */
import { readFile } from "node:fs/promises";
import {
  type LinghunConfig,
  type ModelCapability,
  type ModelRole,
  type RoleModelRoute,
  defaultConfig,
  getProjectSettingsPath,
  lastProviderEnvWarning,
  readProviderEnvValues,
} from "@linghun/config";
import {
  type EndpointProfile,
  resolveEffectiveEndpointProfile,
  resolveProviderBaseUrlDiagnostic,
  resolveProviderRuntimeContract,
} from "@linghun/providers";
import type { Language } from "@linghun/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal context subset needed by doctor helpers — avoids full TuiContext dependency. */
export type ModelDoctorContext = {
  config: LinghunConfig;
  projectPath: string;
  language: Language;
  routeDecisions: Array<{
    role: ModelRole;
    triggerReason: string;
    selectedProvider: string;
    selectedModel: string;
    fallbackUsed?: boolean;
    stopConditions: string[];
  }>;
  lastProviderFailure?: {
    code: string;
    provider: string;
    model: string;
    endpointProfile: string;
  };
};

// ---------------------------------------------------------------------------
// Key safety
// ---------------------------------------------------------------------------

export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}

export function getProviderKeySource(
  providerId: string,
  projectSettingsApiKeyProviders: Set<string>,
  providerEnvApiKeyProviders: Set<string>,
): string {
  const envName = providerId === "deepseek" ? "LINGHUN_DEEPSEEK_API_KEY" : "LINGHUN_OPENAI_API_KEY";
  if (process.env[envName]) return "env";
  if (providerEnvApiKeyProviders.has(providerId)) return "user-provider-env";
  if (projectSettingsApiKeyProviders.has(providerId)) return "project-settings-legacy";
  return "merged-config";
}

// ---------------------------------------------------------------------------
// Provider env / project settings key detection
// ---------------------------------------------------------------------------

export async function readProjectSettingsApiKeyProviders(
  projectPath: string,
): Promise<Set<string>> {
  try {
    const raw = await readFile(getProjectSettingsPath(projectPath), "utf8");
    const parsed = JSON.parse(raw) as { providers?: Record<string, { apiKey?: unknown }> };
    return new Set(
      Object.entries(parsed.providers ?? {})
        .filter(([, provider]) => typeof provider.apiKey === "string" && provider.apiKey.length > 0)
        .map(([providerId]) => providerId),
    );
  } catch {
    return new Set();
  }
}

export async function readProviderEnvApiKeyProviders(): Promise<Set<string>> {
  try {
    const values = await readProviderEnvValues();
    return new Set(values.LINGHUN_OPENAI_API_KEY ? ["openai-compatible"] : []);
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

export function isModelRole(value: string): value is ModelRole {
  return ["planner", "executor", "reviewer", "verifier", "summarizer", "vision", "image"].includes(
    value,
  );
}

export function getRoleRoute(config: LinghunConfig, role: ModelRole): RoleModelRoute {
  const route = config.modelRoutes.routes.find((item) => item.role === role);
  if (route) {
    return route;
  }
  return {
    role,
    provider: "",
    primaryModel: "",
    fallbackModels: [],
    requiredCapabilities: ["text"],
    allowTools: false,
    allowWrite: false,
    allowBash: false,
    requireApprovalBeforeRun: true,
  };
}

export function isDefaultExecutorRoute(route: RoleModelRoute, config: LinghunConfig): boolean {
  return (
    route.provider === "deepseek" && route.primaryModel === defaultConfig.providers.deepseek.model
  );
}

// ---------------------------------------------------------------------------
// Route formatting
// ---------------------------------------------------------------------------

export function formatModelRouteSummary(config: LinghunConfig): string {
  const routes = config.modelRoutes.routes
    .map(
      (route) =>
        `${route.role}:${route.provider || "unknown"}/${route.primaryModel || "unconfigured"}`,
    )
    .slice(0, 4);
  return `角色路由摘要：${routes.length > 0 ? routes.join("；") : "未配置"}`;
}

export function formatModelRoutes(config: LinghunConfig): string {
  return [
    "Model routes（多模型按角色触发，不默认乱开）",
    ...config.modelRoutes.routes.map((route) =>
      [
        `- ${route.role}: provider=${route.provider || "未配置"}`,
        `model=${route.primaryModel || "未配置"}`,
        `capabilities=${route.requiredCapabilities.join("+") || "none"}`,
        `tools=${route.allowTools ? "yes" : "no"}`,
        `write=${route.allowWrite ? "yes" : "no"}`,
        `bash=${route.allowBash ? "yes" : "no"}`,
        `budget=${route.maxCostCny === undefined ? "unconfigured" : `estimated <= ${route.maxCostCny} CNY`}`,
      ].join("  "),
    ),
    "提示：/model route doctor 诊断缺 provider、能力不足和预算配置。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Doctor diagnostics
// ---------------------------------------------------------------------------

export function hasOpenAiCompatibleProviderSetupProblem(
  provider: LinghunConfig["providers"][string],
): boolean {
  return (
    provider.type === "openai-compatible" &&
    (!provider.baseUrl ||
      !provider.apiKey ||
      !provider.model ||
      provider.model === "openai-compatible-model")
  );
}

export function hasOpenAiCompatibleDoctorProblem(config: LinghunConfig): boolean {
  const provider = config.providers["openai-compatible"];
  return Boolean(
    provider &&
      (!provider.baseUrl ||
        !provider.apiKey ||
        !provider.model ||
        provider.model === "openai-compatible-model"),
  );
}

export function hasOpenAiCompatiblePlaceholderProblem(config: LinghunConfig): boolean {
  return config.providers["openai-compatible"]?.model === "openai-compatible-model";
}

export async function formatModelRouteDoctor(context: ModelDoctorContext): Promise<string> {
  const lines = ["Model route doctor"];
  const projectSettingsApiKeyProviders = await readProjectSettingsApiKeyProviders(
    context.projectPath,
  );
  const providerEnvApiKeyProviders = await readProviderEnvApiKeyProviders();
  if (lastProviderEnvWarning) {
    lines.push(
      `WARN: provider.env 读取失败；path=${lastProviderEnvWarning.path}；reason=${lastProviderEnvWarning.reason}；请修正后重启 Linghun 或重新运行 /model setup。`,
    );
  }
  // D.13F：顶层 promptCache 摘要（仅展示 enabled / systemTtl，与具体 provider 无关）。
  // 不输出 apiKey、prompt 明文、cacheBreakNonce、raw request/response，仅状态字段。
  lines.push(
    `- promptCache: enabled=${context.config.promptCache.enabled ? "yes" : "no"} systemTtl=${context.config.promptCache.systemTtl} (5m 默认 cache_control 无 ttl 字面量；1h 才显式写 ttl)`,
  );
  lines.push("- providers:");
  for (const [providerId, provider] of Object.entries(context.config.providers)) {
    const endpointProfile = provider.endpointProfile ?? "chat_completions";
    const compatibilityProfile =
      provider.compatibilityProfile ??
      (provider.type === "deepseek" ? "deepseek" : "strict_openai_compatible");
    const reasoningLevel = provider.reasoningLevel;
    const reasoningStatus = reasoningLevel
      ? endpointProfile === "responses"
        ? `effective/sent level=${reasoningLevel}`
        : compatibilityProfile === "permissive_openai_compatible"
          ? `effective/sent level=${reasoningLevel}`
          : `ignored/unsupported/未生效 compatibilityProfile=${compatibilityProfile}`
      : "not configured/未生效";
    const baseUrlDiagnostic = resolveProviderBaseUrlDiagnostic(
      provider.baseUrl,
      endpointProfile as EndpointProfile,
    );
    const keySource = provider.apiKey
      ? getProviderKeySource(providerId, projectSettingsApiKeyProviders, providerEnvApiKeyProviders)
      : undefined;
    const contract = resolveProviderRuntimeContract({ id: providerId, ...provider });
    // 决策器输出：source / reason / warnings 让 /model doctor 显示"为什么是这个 endpoint"。
    // 仅作只读摘要追加，不改 contract / endpointProfile / endpointPath 主行的信号。
    const decision = resolveEffectiveEndpointProfile({
      requestEndpointProfile: undefined,
      configEndpointProfile: provider.endpointProfile,
      configBaseUrl: provider.baseUrl,
      configModel: provider.model,
      requestModel: undefined,
    });
    lines.push(
      `  - ${providerId}: type=${provider.type} provider=${providerId} model=${provider.model || "missing"} runtimeProfile=${contract.profile} endpointProfile=${contract.endpointProfile} compatibilityProfile=${contract.compatibilityProfile} baseUrl=${provider.baseUrl ? "present" : "missing"} endpointPath=${baseUrlDiagnostic.endpointPath} tools=${contract.supportsTools ? "enabled" : "disabled"} toolSchema=${contract.toolSchemaShape} toolResult=${contract.toolResultShape} retry=${contract.retryStatuses.join("/")}x${contract.maxAttempts} timeoutMs=${contract.requestTimeoutMs} idleTimeoutMs=${contract.streamIdleTimeoutMs} includeUsage=${contract.includeUsage ? "yes" : "no"} reasoning=${reasoningStatus} apiKey=${provider.apiKey && keySource ? `present source=${keySource} masked=${maskSecret(provider.apiKey)}` : "missing source=missing"}`,
    );
    lines.push(`    endpointProfile decision: source=${decision.source} reason=${decision.reason}`);
    // D.13G：tools=disabled 时显式标注原因；anthropic_messages profile 现已原生支持 tools，
    // 仅在 contract.supportsTools=false（用户显式禁用）时才印 reason。
    if (!contract.supportsTools) {
      const reason =
        contract.endpointProfile === "anthropic_messages"
          ? "anthropic_messages profile 已原生支持 tools，但当前 provider 显式声明 supportsTools=false；如需启用请把配置改为 supportsTools=true 或删除该字段"
          : `runtime contract supportsTools=false (profile=${contract.profile})`;
      lines.push(`    tools disabled reason: ${reason}`);
    }
    // D.13G：anthropic_messages tools 启用时显式标注 schema/sort 属性，便于诊断。
    if (contract.endpointProfile === "anthropic_messages" && contract.supportsTools) {
      lines.push(
        "    anthropic tools: enabled schema=anthropic_tools(input_schema) tool_choice=auto/none sort=name-asc(stable for prompt cache)",
      );
    }
    // D.13F：Anthropic prompt cache 可观察字段说明（与 promptCache.enabled 联动）。
    // 显示是否会附加 cache_control 和 ephemeral_5m / ephemeral_1h usage 计数透出情况。
    if (contract.endpointProfile === "anthropic_messages") {
      const promptCacheEnabled = context.config.promptCache.enabled;
      const ttl = context.config.promptCache.systemTtl;
      lines.push(
        `    anthropic prompt cache: cache_control=${
          promptCacheEnabled ? `injected ttl=${ttl === "1h" ? "1h" : "5m-default(no ttl literal)"}` : "off"
        } usage_fields=cache_creation.ephemeral_5m_input_tokens/ephemeral_1h_input_tokens (read-only when emitted by upstream)`,
      );
    }
    if (projectSettingsApiKeyProviders.has(providerId)) {
      lines.push(
        `    WARN: project-settings provider=${providerId} contains apiKey; project .linghun/settings.json 不建议保存 apiKey，请迁移到环境变量或私有配置。`,
      );
    }
    if (decision.warnings.length > 0) {
      for (const warning of decision.warnings) {
        lines.push(`    warning: ${warning}`);
      }
    }
    if (baseUrlDiagnostic.hasQueryOrFragment) {
      lines.push(
        "    warning: baseUrl 包含 query/fragment；doctor 不显示原值，请改为不含 query/fragment 的 root baseUrl。",
      );
      lines.push(`    recommendation: ${baseUrlDiagnostic.recommendation}`);
    }
    if (baseUrlDiagnostic.fullEndpointSuffix) {
      lines.push(
        `    warning: baseUrl 包含完整 endpoint suffix=${baseUrlDiagnostic.fullEndpointSuffix}；已按 root baseUrl 诊断，最终 endpointPath=${baseUrlDiagnostic.endpointPath}`,
      );
      lines.push(`    recommendation: ${baseUrlDiagnostic.recommendation}`);
      if (baseUrlDiagnostic.profileMismatch) {
        lines.push(
          `    profile/baseUrl 不匹配：baseUrl suffix=${baseUrlDiagnostic.fullEndpointSuffix}，endpointProfile=${endpointProfile}`,
        );
      }
    }
  }
  for (const route of context.config.modelRoutes.routes) {
    const problems = diagnoseRoute(route, context.config);
    const level = getRouteDoctorLevel(route, problems, context.config);
    lines.push(
      `- ${route.role}: ${level}${problems.length === 0 ? "" : `：${problems.join("；")}`} provider=${route.provider || "未配置"} model=${route.primaryModel || "未配置"} fallback=${route.fallbackModels.length > 0 ? route.fallbackModels.join(",") : "未配置"}`,
    );
  }
  if (context.routeDecisions.length > 0) {
    lines.push("- recent route decisions:");
    for (const decision of context.routeDecisions.slice(0, 3)) {
      lines.push(
        `  - ${decision.role}: trigger=${decision.triggerReason} selected=${decision.selectedProvider || "paused"}/${decision.selectedModel || "paused"} fallbackUsed=${decision.fallbackUsed ? "yes" : "no"} stop=${decision.stopConditions.length > 0 ? decision.stopConditions.join("|") : "none"}`,
      );
    }
  }
  if (context.lastProviderFailure) {
    const failure = context.lastProviderFailure;
    lines.push(
      `- last provider failure: code=${failure.code} provider=${failure.provider} model=${failure.model} endpointProfile=${failure.endpointProfile}; details: /details evidence`,
    );
  }
  if (hasOpenAiCompatibleDoctorProblem(context.config)) {
    lines.push(
      "- openai-compatible 修复：设置 LINGHUN_OPENAI_BASE_URL、LINGHUN_OPENAI_API_KEY、LINGHUN_OPENAI_MODEL 后重启 Linghun。",
    );
  }
  if (hasOpenAiCompatiblePlaceholderProblem(context.config)) {
    lines.push(
      "- openai-compatible 占位提示：请检查 .linghun/settings.json，避免 openai-compatible-model 占位值覆盖真实模型。",
    );
  }
  lines.push(
    "- budget: 未配置预算只作为 WARN；金额仅在 /usage 或 /stats 中以 estimated 展示，状态栏不会显示金额。",
  );
  lines.push(
    "- handoff: 角色间只传 summary/evidence/diff/verification/keyFiles，不传完整 transcript/memory/index/logs。",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Route diagnosis
// ---------------------------------------------------------------------------

export function diagnoseRoute(route: RoleModelRoute, config: LinghunConfig): string[] {
  const problems = diagnoseConcreteRoute(route, route.primaryModel, route.provider, config);
  if (route.fallbackModels.length === 0) {
    problems.push("fallbackModels 未配置");
  }
  for (const fallbackModel of route.fallbackModels) {
    const fallbackProvider = inferProviderForRouteModel(fallbackModel, config);
    const fallbackProblems = diagnoseConcreteRoute(route, fallbackModel, fallbackProvider, config);
    if (getRouteBlockingProblems(fallbackProblems).length > 0) {
      problems.push(
        `fallback 不可用 ${fallbackModel}：${getRouteBlockingProblems(fallbackProblems).join("/")}`,
      );
    }
  }
  if (route.maxCostCny === undefined) {
    problems.push("预算未配置");
  }
  if (
    (route.role === "planner" || route.role === "reviewer" || route.role === "vision") &&
    route.allowWrite
  ) {
    problems.push("权限过宽：不应写文件");
  }
  if (
    (route.role === "vision" || route.role === "image" || route.role === "planner") &&
    route.allowBash
  ) {
    problems.push("权限过宽：不应执行 Bash");
  }
  return problems;
}

export function diagnoseConcreteRoute(
  route: RoleModelRoute,
  model: string,
  providerId: string,
  config: LinghunConfig,
): string[] {
  const problems: string[] = [];
  const provider = providerId ? config.providers[providerId] : undefined;
  if (!providerId) {
    problems.push("缺 provider");
  } else if (!provider) {
    problems.push("provider 未配置");
  }
  if (!model) {
    problems.push("缺模型");
  }
  if (provider?.type === "openai-compatible") {
    if (!provider.baseUrl) problems.push("openai-compatible 缺 baseUrl");
    if (!provider.apiKey) problems.push("openai-compatible 缺 apiKey");
    if (!provider.model || provider.model === "openai-compatible-model") {
      problems.push("openai-compatible 缺已确认模型");
    }
  }
  for (const capability of route.requiredCapabilities) {
    if (!routeSupportsCapability({ ...route, primaryModel: model }, capability)) {
      problems.push(
        capability === "tools" ? "能力不足：tools/tool calling" : `能力不足：${capability}`,
      );
    }
  }
  return problems;
}

export function getRouteDoctorLevel(
  route: RoleModelRoute,
  problems: string[],
  config: LinghunConfig,
): "BLOCK" | "WARN" | "ok" {
  const primaryProblems = diagnoseConcreteRoute(route, route.primaryModel, route.provider, config);
  const primaryBlocking = getRouteBlockingProblems(primaryProblems);
  if (primaryBlocking.length > 0) {
    const hasUsableFallback = route.fallbackModels.some((fallbackModel) => {
      const fallbackProvider = inferProviderForRouteModel(fallbackModel, config);
      const fallbackProblems = diagnoseConcreteRoute(
        route,
        fallbackModel,
        fallbackProvider,
        config,
      );
      return getRouteBlockingProblems(fallbackProblems).length === 0;
    });
    return hasUsableFallback ? "WARN" : "BLOCK";
  }
  return problems.length > 0 ? "WARN" : "ok";
}

export function getRouteBlockingProblems(problems: string[]): string[] {
  return problems.filter(
    (problem) =>
      problem !== "预算未配置" &&
      problem !== "fallbackModels 未配置" &&
      (problem.startsWith("缺") ||
        problem.includes("未配置") ||
        problem.includes("缺 ") ||
        problem.includes("缺已确认") ||
        problem.includes("不匹配") ||
        problem.startsWith("能力不足")),
  );
}

export function routeSupportsCapability(
  route: RoleModelRoute,
  capability: ModelCapability,
): boolean {
  if (capability === "text") {
    return Boolean(route.primaryModel);
  }
  if (capability === "vision") {
    return /vision|vl|gpt-4o|claude|qwen|glm|kimi/i.test(route.primaryModel);
  }
  if (capability === "image") {
    return /image|dall|gpt-image|flux|sd|comfy/i.test(route.primaryModel);
  }
  if (capability === "tools") {
    return route.allowTools;
  }
  if (capability === "thinking") {
    return /pro|reason|thinking|claude|gpt/i.test(route.primaryModel);
  }
  if (capability === "promptCache") {
    return /claude|gpt|deepseek/i.test(route.primaryModel);
  }
  return false;
}

export function inferProviderForRouteModel(model: string, config: LinghunConfig): string {
  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (provider.model === model) {
      return providerId;
    }
  }
  return model.startsWith("deepseek-") ? "deepseek" : "openai-compatible";
}
