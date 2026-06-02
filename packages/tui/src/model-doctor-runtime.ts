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
  defaultPlaceholderModelNames,
  getProjectSettingsPath,
  isDefaultPlaceholderModel,
  lastProviderEnvMerge,
  lastProviderEnvWarning,
  readProviderEnvValues,
} from "@linghun/config";
import {
  type EndpointProfile,
  resolveAnthropicContextEditingDiagnostic,
  resolveEffectiveEndpointProfile,
  resolveProviderBaseUrlDiagnostic,
  resolveProviderRuntimeContract,
} from "@linghun/providers";
import type { Language } from "@linghun/shared";
import {
  type ProviderCircuitBreakerState,
  formatCooldownDoctorLine,
} from "./provider-circuit-breaker.js";
import {
  type ProviderFailureKind,
  formatProviderFailureKindLabel,
} from "./request-lifecycle-presenter.js";

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
    kind?: string;
    provider: string;
    model: string;
    endpointProfile: string;
  };
  lastProviderFallbackAttempt?: {
    fromProvider: string;
    fromModel: string;
    toProvider: string;
    toModel: string;
    reasonKind: string;
    reasonCode: string;
    status: "attempted" | "succeeded" | "failed";
    summary: string;
  };
  providerBreaker?: ProviderCircuitBreakerState;
  // D.13I：deferred 工具发现快照摘要。仅含 total / byKind / executableCount，不含 raw schema/secret/参数；
  // 由调用方（index.ts）注入 snapshotDeferredTools(context) 的摘要字段，doctor 仅做 read-only 渲染。
  deferredToolsSummary?: {
    total: number;
    byKind: { "codebase-memory": number; mcp: number; skill: number; plugin: number };
    executableCount: number;
  };
  // D.13J Block 2：本 session 通过 SearchExtraTools 已发现的 deferred 工具名摘要。
  // 由 index.ts 通过 snapshotDiscoveredDeferredToolsSummary 注入；doctor 仅做 read-only 渲染。
  // 仅 sanitized 名字 + total + truncated 标志，**不**输出 raw 参数 / schema / 调用计数。
  discoveredDeferredToolsSummary?: {
    total: number;
    names: string[];
    truncated: boolean;
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

// D.13J Block 1：检查任意 provider / role route 是否仍在使用占位 / 未成熟模型名。
// `defaultPlaceholderModelNames` 涵盖 deepseek-v4-flash / deepseek-v4-pro / openai-compatible-model 等，
// 这些名字需要被 doctor 显式标记，避免用户在 smoke 中第一次发请求就 404。
export function collectPlaceholderModelHits(config: LinghunConfig): {
  providers: Array<{ providerId: string; model: string }>;
  routes: Array<{ role: string; field: "primary" | "fallback"; model: string }>;
} {
  const providers: Array<{ providerId: string; model: string }> = [];
  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (isDefaultPlaceholderModel(provider.model)) {
      providers.push({ providerId, model: provider.model });
    }
  }
  const routes: Array<{ role: string; field: "primary" | "fallback"; model: string }> = [];
  for (const route of config.modelRoutes.routes) {
    if (isDefaultPlaceholderModel(route.primaryModel)) {
      routes.push({ role: route.role, field: "primary", model: route.primaryModel });
    }
    for (const fallbackModel of route.fallbackModels) {
      if (isDefaultPlaceholderModel(fallbackModel)) {
        routes.push({ role: route.role, field: "fallback", model: fallbackModel });
      }
    }
  }
  return { providers, routes };
}

export async function formatModelRouteDoctor(context: ModelDoctorContext): Promise<string> {
  const isEn = context.language === "en-US";
  const lines = [isEn ? "Model route doctor" : "模型路由诊断"];
  const projectSettingsApiKeyProviders = await readProjectSettingsApiKeyProviders(
    context.projectPath,
  );
  const providerEnvApiKeyProviders = await readProviderEnvApiKeyProviders();
  if (lastProviderEnvWarning) {
    lines.push(
      `WARN: provider.env 读取失败；path=${lastProviderEnvWarning.path}；reason=${lastProviderEnvWarning.reason}；请修正后重启 Linghun 或重新运行 /model setup。`,
    );
  }
  // D.13J Block 1：provider.env 合并可见化。
  // 用户在 ~/.linghun/provider.env 写的内容会覆盖项目级 modelRoutes/defaultModel/providers，
  // 之前没有任何 doctor 输出能告诉用户"被覆盖了"——sm​oke 第一次请求 404 才发现。
  // 现在 doctor 摘要明确给出 applied 状态、是否覆盖了 modelRoutes/defaultModel、引入了哪些 provider id。
  // 仅记录布尔与 provider id 列表，**不**输出任何 apiKey/baseUrl/model 值。
  if (lastProviderEnvMerge?.applied) {
    const ids = lastProviderEnvMerge.providerIds;
    lines.push(
      `- provider.env merge: applied=yes overrodeModelRoutes=${lastProviderEnvMerge.overrodeModelRoutes ? "yes" : "no"} overrodeDefaultModel=${lastProviderEnvMerge.overrodeDefaultModel ? "yes" : "no"} providers=${ids.length > 0 ? ids.join(",") : "none"} (~/.linghun/provider.env 优先级最高，会覆盖项目 settings.json；如果 smoke 出现 404，请检查该文件是否存在、确认 provider id、或临时改名。安全提示：provider.env 含敏感凭据，不要 cat/type 到主屏、日志或报告)`,
    );
  } else if (lastProviderEnvMerge && !lastProviderEnvMerge.applied) {
    lines.push(
      "- provider.env merge: applied=no (~/.linghun/provider.env 未覆盖项目 settings；如需切换 provider 请使用 /model setup)",
    );
  }
  // D.13J Block 1：占位 / 未成熟模型名 doctor 标记。
  // deepseek-v4-flash / deepseek-v4-pro / openai-compatible-model 都是占位符；
  // 出现在 provider.model 或 route.primary/fallback 上时，必须显式提示用户用环境变量替换为现役模型名。
  const placeholderHits = collectPlaceholderModelHits(context.config);
  if (placeholderHits.providers.length > 0 || placeholderHits.routes.length > 0) {
    const providerHits = placeholderHits.providers
      .map((hit) => `${hit.providerId}=${hit.model}`)
      .join(",");
    const routeHits = placeholderHits.routes
      .map((hit) => `${hit.role}.${hit.field}=${hit.model}`)
      .join(",");
    lines.push(
      `- WARN placeholder model: providers=[${providerHits || "none"}] routes=[${routeHits || "none"}] (这些是占位/未成熟模型名；smoke 前请用 LINGHUN_DEEPSEEK_MODEL/LINGHUN_DEFAULT_MODEL 替换为现役模型名，例如 deepseek-chat/deepseek-reasoner)`,
    );
  }
  // D.13F：顶层 promptCache 摘要（仅展示 enabled / systemTtl，与具体 provider 无关）。
  // 不输出 apiKey、prompt 明文、cacheBreakNonce、raw request/response，仅状态字段。
  lines.push(
    `- promptCache: enabled=${context.config.promptCache.enabled ? "yes" : "no"} systemTtl=${context.config.promptCache.systemTtl} (5m 默认 cache_control 无 ttl 字面量；1h 才显式写 ttl)`,
  );
  // D.13I：deferred 工具发现摘要。仅展示 total / byKind / executableCount，
  // 不含 raw schema/secret/参数；用户 /model doctor 时才看到 deferred 命名空间是否被发现。
  if (context.deferredToolsSummary) {
    const summary = context.deferredToolsSummary;
    lines.push(
      `- deferredTools: total=${summary.total} executable=${summary.executableCount} codebase-memory=${summary.byKind["codebase-memory"]} mcp=${summary.byKind.mcp} skill=${summary.byKind.skill} plugin=${summary.byKind.plugin} (SearchExtraTools/ExecuteExtraTool 入口；built-in 工具不走该派发)`,
    );
  }
  // D.13J Block 2：本 session 通过 SearchExtraTools 已发现的 deferred 工具名摘要。
  // 解决 ExecuteExtraTool 被拒时无法直接看出"是没发现还是参数错"的可见性问题。
  // discoveredDeferredToolNames 是 session-scoped Set；session 重启即清零。
  if (context.discoveredDeferredToolsSummary) {
    const ds = context.discoveredDeferredToolsSummary;
    if (ds.total === 0) {
      lines.push(
        "- discoveredDeferredTools: 0 (本 session 还没运行过 SearchExtraTools；ExecuteExtraTool 现在会全部拒绝。请先 SearchExtraTools)",
      );
    } else {
      const visible = ds.names.join(",");
      const tail = ds.truncated ? `,…+${ds.total - ds.names.length} more` : "";
      lines.push(
        `- discoveredDeferredTools: total=${ds.total} names=[${visible}${tail}] (本 session 经 SearchExtraTools 记录过的工具名；session 重启即清零)`,
      );
    }
  }
  lines.push("- providers:");
  for (const [providerId, provider] of Object.entries(context.config.providers)) {
    const endpointProfile = provider.endpointProfile ?? "chat_completions";
    const compatibilityProfile =
      provider.compatibilityProfile ??
      (provider.type === "deepseek" ? "deepseek" : "strict_openai_compatible");
    const reasoningLevel = provider.reasoningLevel;
    // D.13L Block A — doctor 主行说人话：
    //   "推理 High 已发送" / "Reasoning High sent"（生效路径）
    //   "未配置推理等级" / "Reasoning not configured"（缺省）
    //   "推理 High 不会发送（当前网关或模型不接受）" / "Reasoning High not sent ..."（不生效）
    // 技术字段（effective/sent level=High，路径详情）仍写在同一行的括号里，
    // 避免再开一段；既不破坏现有 doctor grep 用例（仍含 effective/sent 关键字），
    // 也让普通用户能直接看懂主行。
    const reasoningSentLocal = Boolean(
      reasoningLevel &&
        (endpointProfile === "responses" ||
          endpointProfile === "anthropic_messages" ||
          compatibilityProfile === "permissive_openai_compatible"),
    );
    const reasoningPlain = !reasoningLevel
      ? context.language === "en-US"
        ? "Reasoning not configured"
        : "未配置推理等级"
      : reasoningSentLocal
        ? context.language === "en-US"
          ? `Reasoning ${reasoningLevel} sent`
          : `推理 ${reasoningLevel} 已发送`
        : context.language === "en-US"
          ? `Reasoning ${reasoningLevel} not sent (gateway or model rejects it)`
          : `推理 ${reasoningLevel} 不会发送（当前网关或模型不接受）`;
    const reasoningTechnical = reasoningLevel
      ? endpointProfile === "responses"
        ? `effective/sent level=${reasoningLevel}`
        : endpointProfile === "anthropic_messages"
          ? `effective/sent level=${reasoningLevel}`
          : compatibilityProfile === "permissive_openai_compatible"
            ? `effective/sent level=${reasoningLevel}`
            : `ignored/unsupported/未生效 compatibilityProfile=${compatibilityProfile}`
      : "not configured/未生效";
    // 顺序保持 technical 在前：现有 grep 用例期望 `reasoning=ignored/unsupported`
    // / `reasoning=effective/sent` / `reasoning=not configured` 直接跟在 `reasoning=`
    // 后面；human-readable 段放在括号里，给普通用户当主语义看，但不破坏 grep。
    const reasoningStatus = `${reasoningTechnical} (${reasoningPlain})`;
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
    if (provider.type === "openai-compatible") {
      lines.push(
        "    openai-compatible endpoint hint: root baseUrl + responses 可能可用；chat_completions 通常需要 /v1 root；如果返回 content-type=text/html，baseUrl 可能填到了网页登录页或少了 /v1。",
      );
    }
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
          promptCacheEnabled
            ? `injected ttl=${ttl === "1h" ? "1h" : "5m-default(no ttl literal)"}`
            : "off"
        } usage_fields=cache_creation.ephemeral_5m_input_tokens/ephemeral_1h_input_tokens (read-only when emitted by upstream)`,
      );
      // D.13H：Anthropic Context Editing / cache_edits 收口（hard-disabled）。
      // 仅输出 enabled / sendable / betaHeaders count / disabled reason；不输出
      // raw beta header 字符串、不输出 apiKey、不输出 prompt。
      const contextEditing = resolveAnthropicContextEditingDiagnostic(
        {
          contextEditingEnabled: provider.contextEditingEnabled,
          anthropicBetaHeaders: provider.anthropicBetaHeaders,
        },
        contract,
      );
      lines.push(
        `    anthropic context editing: enabled=${contextEditing.enabled ? "yes" : "no"} sendable=${contextEditing.sendable ? "yes" : "no"} betaHeaders=${contextEditing.betaHeaderCount} reason=${contextEditing.disabledReason ?? "ok"} (cache_edits/cache_reference body 字段 hard-disabled)`,
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
    lines.push(isEn ? "- recent route decisions:" : "- 最近路由决策：");
    for (const decision of context.routeDecisions.slice(0, 3)) {
      lines.push(
        `  - ${decision.role}: trigger=${decision.triggerReason} selected=${decision.selectedProvider || "paused"}/${decision.selectedModel || "paused"} fallbackUsed=${decision.fallbackUsed ? "yes" : "no"} stop=${decision.stopConditions.length > 0 ? decision.stopConditions.join("|") : "none"}`,
      );
    }
  }
  if (context.providerBreaker) {
    const cooldownLine = formatCooldownDoctorLine(context.providerBreaker, context.language);
    if (cooldownLine) {
      lines.push(`- ${cooldownLine}`);
    }
  }
  if (context.lastProviderFailure) {
    const failure = context.lastProviderFailure;
    const failureKind = toProviderFailureKind(
      isProviderTransitFailureCode(failure.code) ? "transit" : failure.kind,
    );
    const humanKind = formatProviderFailureKindLabel(failureKind, context.language);
    if (isEn) {
      lines.push(
        `- last model-service failure: kind=${humanKind} code=${failure.code} provider=${failure.provider} model=${failure.model} endpointProfile=${failure.endpointProfile}; details: /details evidence`,
      );
      if (failure.kind === "quota_or_balance_exhausted") {
        lines.push(
          "- quota/balance note: this is an upstream error classification, not a balance query.",
        );
      }
    } else {
      lines.push(
        `- 最近模型服务失败：类型=${humanKind} code=${failure.code} 服务商=${failure.provider} 模型=${failure.model} 接口类型=${failure.endpointProfile}；详情：/details evidence`,
      );
      if (failure.kind === "quota_or_balance_exhausted") {
        lines.push("- 额度/余额说明：这是上游错误分类，不是 Linghun 查询余额的结果。");
      }
    }
  }
  if (context.lastProviderFallbackAttempt) {
    const attempt = context.lastProviderFallbackAttempt;
    const reason = formatProviderFailureKindLabel(
      toProviderFailureKind(attempt.reasonKind),
      context.language,
    );
    const statusText =
      context.language === "en-US"
        ? attempt.status
        : attempt.status === "attempted"
          ? "已尝试"
          : attempt.status === "succeeded"
            ? "已成功"
            : "已失败";
    lines.push(
      isEn
        ? `- last fallback attempt: ${statusText}; ${attempt.fromProvider}/${attempt.fromModel} -> ${attempt.toProvider}/${attempt.toModel}; reason=${reason} code=${attempt.reasonCode}`
        : `- 最近备用模型尝试：状态=${statusText}；${attempt.fromProvider}/${attempt.fromModel} -> ${attempt.toProvider}/${attempt.toModel}；原因=${reason} code=${attempt.reasonCode}`,
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

function toProviderFailureKind(value: string | undefined): ProviderFailureKind {
  if (
    value === "rate_limit" ||
    value === "quota_or_balance_exhausted" ||
    value === "schema" ||
    value === "auth" ||
    value === "not_found" ||
    value === "gateway" ||
    value === "transit" ||
    value === "timeout" ||
    value === "abort" ||
    value === "reasoning_unsupported"
  ) {
    return value;
  }
  return "generic";
}

function isProviderTransitFailureCode(code: string): boolean {
  return (
    code === "PROVIDER_STREAM_ERROR" ||
    code === "PROVIDER_STREAM_DECODE_ERROR" ||
    code === "PROVIDER_RETRY_EXHAUSTED"
  );
}

// ---------------------------------------------------------------------------
// Route diagnosis
// ---------------------------------------------------------------------------

export function diagnoseRoute(route: RoleModelRoute, config: LinghunConfig): string[] {
  const problems = diagnoseConcreteRoute(route, route.primaryModel, route.provider, config);
  // D.13J tail fix（Block D）：doctor-only placeholder 检查。
  // 只在 doctor 报告层把 placeholder 模型升级为 blocking；不下沉到 diagnoseConcreteRoute，
  // 否则 runRoleModelRoute 也会把所有用 fixture 模型名（deepseek-v4-flash/pro）
  // 的链路一刀切 short-circuit，破坏 agent / permission / verify / review。
  if (route.primaryModel && isDefaultPlaceholderModel(route.primaryModel)) {
    problems.push(`模型 placeholder 未替换为现役模型：${route.primaryModel}`);
  }
  if (route.fallbackModels.length === 0) {
    problems.push("fallbackModels 未配置");
  }
  for (const fallbackModel of route.fallbackModels) {
    const fallbackProvider = inferProviderForRouteModel(fallbackModel, config);
    const fallbackProblems = diagnoseConcreteRoute(route, fallbackModel, fallbackProvider, config);
    if (isDefaultPlaceholderModel(fallbackModel)) {
      fallbackProblems.push(`模型 placeholder 未替换为现役模型：${fallbackModel}`);
    }
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
  // D.13J tail fix（Block D）：doctor-only placeholder 升级为 blocking。
  if (route.primaryModel && isDefaultPlaceholderModel(route.primaryModel)) {
    primaryProblems.push(`模型 placeholder 未替换为现役模型：${route.primaryModel}`);
  }
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
      if (isDefaultPlaceholderModel(fallbackModel)) {
        fallbackProblems.push(`模型 placeholder 未替换为现役模型：${fallbackModel}`);
      }
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
        problem.startsWith("能力不足") ||
        // D.13J tail fix（Block D）：placeholder 模型属于 blocking，不能被当成可用 route。
        problem.startsWith("模型 placeholder")),
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
