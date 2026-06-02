import type { Writable } from "node:stream";
import {
  type ModelRole,
  type ProviderConfig,
  type ProviderEnvSetup,
  ensureProviderEnvTemplate,
  getProviderEnvPath,
  loadConfig,
  providerEnvExists,
  saveModelRoute,
  saveProviderEnvSetup,
} from "@linghun/config";
import { showCommandPanel } from "./command-panel-runtime.js";
import {
  snapshotDeferredToolsSummary,
  snapshotDiscoveredDeferredToolsSummary,
} from "./deferred-tools-catalog.js";
import type { TuiContext } from "./index.js";
import {
  formatModelRouteDoctor,
  formatModelRouteSummary,
  formatModelRoutes,
  getRoleRoute,
  isModelRole,
} from "./model-doctor-runtime.js";
import {
  type ModelSetupPrefill,
  applyModelSetupValues,
  formatModelSetupFallbackError,
  formatModelSetupMessage,
  formatModelSetupSaved,
  formatModelSetupSummary,
  getModelSetupPromptMessage,
  getNextModelSetupStep,
  normalizeModelSetupReasoningLevel,
  parseModelSetupPrefill,
} from "./model-setup-runtime.js";
import { writeLine } from "./startup-runtime.js";
import { getSelectedModelRuntime, resolveInitialModel } from "./tui-model-runtime.js";

export type ModelCommandRuntimeDeps = {
  currentModelText: (context: TuiContext) => string;
};

let runtimeDeps: ModelCommandRuntimeDeps | undefined;

export function configureModelCommandRuntime(deps: ModelCommandRuntimeDeps): void {
  runtimeDeps = deps;
}

function deps(): ModelCommandRuntimeDeps {
  if (!runtimeDeps) {
    throw new Error("model-command-runtime deps not configured");
  }
  return runtimeDeps;
}

function findProviderForModel(
  model: string,
  providers: Record<string, ProviderConfig>,
): string | undefined {
  // First, check if any provider explicitly has this model configured
  for (const [providerId, provider] of Object.entries(providers)) {
    if (provider.model === model) {
      return providerId;
    }
  }
  // For deepseek- prefix models, only allow if deepseek provider exists
  if (model.startsWith("deepseek-")) {
    return providers.deepseek ? "deepseek" : undefined;
  }
  // No automatic fallback to openai-compatible for unknown models
  return undefined;
}

export async function handleModelCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (action === "route") {
    await handleModelRouteCommand(args.slice(1), context, output);
    return;
  }
  if (action === "setup") {
    await startModelSetup(context, output);
    return;
  }
  if (action === "doctor") {
    // D.14D-E — /model doctor 走降噪 CommandPanel：完整诊断进 detailsText
    // （Ctrl+O 展开），非 ink 仍 writeLine 完整正文，保留既有断言。
    const isEn = context.language === "en-US";
    showCommandPanel(context, output, {
      title: "/model doctor",
      tone: "neutral",
      summary: [
        isEn
          ? "Model route doctor — Ctrl+O for full diagnostics."
          : "模型路由诊断 — Ctrl+O 查看完整诊断。",
      ],
      detailsText: await formatModelRouteDoctor({
        ...context,
        deferredToolsSummary: snapshotDeferredToolsSummary(context),
        discoveredDeferredToolsSummary: snapshotDiscoveredDeferredToolsSummary(context),
      }),
    });
    return;
  }
  if (action === "set") {
    const model = args[1];
    if (!model) {
      writeLine(output, "用法：/model set <model>");
      return;
    }
    // Validate model exists in configured providers
    const provider = findProviderForModel(model, context.config.providers);
    if (!provider) {
      writeLine(output, `错误：未找到模型 "${model}"。请先配置对应 provider 或运行 /model setup。`);
      return;
    }
    // Set executor role and update defaultModel
    context.config = await saveModelRoute("executor", model, context.projectPath);
    context.model = model;
    const route = getRoleRoute(context.config, "executor");
    writeLine(output, `已设置默认模型为 ${model}（provider=${route.provider}，role=executor）`);
    if (context.config.defaultModel !== model) {
      writeLine(
        output,
        `说明：executor role 已设置为 ${model}，defaultModel=${context.config.defaultModel}`,
      );
    }
    return;
  }
  const runtime = getSelectedModelRuntime(context);
  // D.13Q-UX Task Surface — /model 默认走降噪 CommandPanel：仅显示 role /
  // provider / model / reasoning，路由摘要和"运行 /model doctor"建议进 panel
  // actions / detailsText（Ctrl+O 展开），不再 writeLine 多行写进 transcript。
  // body 仍保留 `reasoning=${runtime.reasoningStatus}` 字面量，让用户能在
  // detailsText（Ctrl+O 展开）里看到运行时决策。
  const isEn = context.language === "en-US";
  const reasoningSegment = `reasoning=${runtime.reasoningStatus}`;
  const summary: string[] = [
    isEn
      ? `Model · ${runtime.provider}/${runtime.model}`
      : `模型 · ${runtime.provider}/${runtime.model}`,
    isEn
      ? `Role: ${runtime.role} · ${reasoningSegment}`
      : `角色：${runtime.role} · ${reasoningSegment}`,
  ];
  if (context.config.defaultModel && context.config.defaultModel !== runtime.model) {
    summary.push(
      isEn
        ? `defaultModel=${context.config.defaultModel} (executor stays on ${runtime.model})`
        : `defaultModel=${context.config.defaultModel}（实际 executor=${runtime.model}）`,
    );
  }
  showCommandPanel(context, output, {
    title: "/model",
    tone: "neutral",
    summary,
    actions: ["/model doctor", "/model route", "/model setup"],
    detailsText: `${deps().currentModelText(context)}：role=${runtime.role} provider=${runtime.provider} model=${runtime.model} ${reasoningSegment}\n\n${formatModelRouteSummary(context.config)}`,
  });
  // Task-mode denoise: previously this called writeStatus(output, context),
  // which emits the full `[Linghun] 会话 …` line and is the dominant noise
  // source above the composer.
}

export async function startModelSetup(
  context: TuiContext,
  output: Writable,
  prefill: ModelSetupPrefill = {},
): Promise<void> {
  const existed = await providerEnvExists();
  const providerEnvPath = existed ? getProviderEnvPath() : await ensureProviderEnvTemplate();
  const values: Partial<ProviderEnvSetup> = { reasoningLevel: "Medium", ...prefill };
  context.pendingModelSetup = {
    step: getNextModelSetupStep(values),
    providerEnvPath,
    createdTemplate: !existed,
    values,
  };
  writeLine(output, formatModelSetupMessage("intro", context.language, context.pendingModelSetup));
  if (context.pendingModelSetup.step === "confirm") {
    writeLine(output, formatModelSetupSummary(context.pendingModelSetup, context.language));
    return;
  }
  writeLine(output, getModelSetupPromptMessage(context.pendingModelSetup, context.language));
}

export async function handleModelSetupInput(
  text: string,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const setup = context.pendingModelSetup;
  if (!setup) return;
  const trimmed = text.trim();
  const value = setup.step === "apiKey" ? text : trimmed;
  if (/^(cancel|no|n|取消|否)$/iu.test(trimmed)) {
    context.pendingModelSetup = undefined;
    writeLine(output, formatModelSetupMessage("cancelled", context.language, setup));
    return;
  }
  if (/^(details|detail|详情)$/iu.test(trimmed)) {
    writeLine(output, formatModelSetupMessage("details", context.language, setup));
    writeLine(output, getModelSetupPromptMessage(setup, context.language));
    return;
  }

  try {
    const parsed = parseModelSetupPrefill(text);
    if (Object.keys(parsed).length > 0) {
      applyModelSetupValues(setup, parsed);
      setup.step = getNextModelSetupStep(setup.values);
      if (setup.step === "confirm") {
        writeLine(output, formatModelSetupSummary(setup, context.language));
        return;
      }
      writeLine(output, getModelSetupPromptMessage(setup, context.language));
      return;
    }

    if (setup.step === "baseUrl") {
      applyModelSetupValues(setup, { baseUrl: value });
      setup.step = "apiKey";
      writeLine(output, getModelSetupPromptMessage(setup, context.language));
      return;
    }
    if (setup.step === "apiKey") {
      applyModelSetupValues(setup, { apiKey: value });
      setup.step = "model";
      writeLine(output, getModelSetupPromptMessage(setup, context.language));
      return;
    }
    if (setup.step === "model") {
      applyModelSetupValues(setup, { model: value });
      setup.step = "reasoning";
      writeLine(output, getModelSetupPromptMessage(setup, context.language));
      return;
    }
    if (setup.step === "reasoning") {
      applyModelSetupValues(setup, {
        reasoningLevel: normalizeModelSetupReasoningLevel(value || "Medium"),
      });
      setup.step = "auxModel";
      writeLine(output, getModelSetupPromptMessage(setup, context.language));
      return;
    }
    if (setup.step === "auxModel") {
      applyModelSetupValues(setup, { auxModel: value || undefined });
      setup.step = "confirm";
      writeLine(output, formatModelSetupSummary(setup, context.language));
      return;
    }
    if (setup.step === "confirm") {
      if (/^(yes|y|save|ok|confirm|确认|保存|是)$/iu.test(value)) {
        const savedPath = await saveProviderEnvSetup(setup.values as ProviderEnvSetup);
        context.pendingModelSetup = undefined;
        context.config = await loadConfig(context.projectPath);
        context.model = resolveInitialModel(context.config);
        writeLine(output, formatModelSetupSaved(savedPath, context.language));
        return;
      }
      context.pendingModelSetup = undefined;
      writeLine(output, formatModelSetupMessage("cancelled", context.language, setup));
      return;
    }
  } catch (error) {
    writeLine(
      output,
      error instanceof Error ? error.message : formatModelSetupFallbackError(context.language),
    );
    writeLine(output, getModelSetupPromptMessage(setup, context.language));
  }
}

export async function handleModelRouteCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action) {
    // D.14D-E — /model route 走降噪 CommandPanel：完整路由表进 detailsText。
    const isEn = context.language === "en-US";
    showCommandPanel(context, output, {
      title: "/model route",
      tone: "neutral",
      summary: [
        isEn
          ? `Model routes · ${context.config.modelRoutes.routes.length} roles — Ctrl+O for details.`
          : `模型路由 · ${context.config.modelRoutes.routes.length} 个角色 — Ctrl+O 查看详情。`,
      ],
      actions: ["/model route doctor"],
      detailsText: formatModelRoutes(context.config),
    });
    return;
  }
  if (action === "doctor") {
    // D.14D-E — /model route doctor 走降噪 CommandPanel：完整诊断进 detailsText。
    const isEn = context.language === "en-US";
    showCommandPanel(context, output, {
      title: "/model route doctor",
      tone: "neutral",
      summary: [
        isEn
          ? "Model route doctor — Ctrl+O for full diagnostics."
          : "模型路由诊断 — Ctrl+O 查看完整诊断。",
      ],
      detailsText: await formatModelRouteDoctor({
        ...context,
        deferredToolsSummary: snapshotDeferredToolsSummary(context),
        discoveredDeferredToolsSummary: snapshotDiscoveredDeferredToolsSummary(context),
      }),
    });
    return;
  }
  if (action === "set") {
    const role = args[1] as ModelRole | undefined;
    const model = args[2];
    if (!role || !isModelRole(role) || !model) {
      writeLine(
        output,
        "用法：/model route set <planner|executor|reviewer|verifier|summarizer|vision|image> <model>",
      );
      return;
    }
    context.config = await saveModelRoute(role, model, context.projectPath);
    const route = getRoleRoute(context.config, role);
    if (role === "executor") {
      context.model = route.primaryModel || context.model;
    }
    writeLine(
      output,
      `已设置 ${role} role：provider=${route.provider || "未配置"} model=${route.primaryModel || "未配置"}`,
    );
    if (role === "executor" && context.config.defaultModel !== route.primaryModel) {
      writeLine(
        output,
        `说明：defaultModel=${context.config.defaultModel}，普通开发请求将按 executor route=${route.provider}/${route.primaryModel} 执行。`,
      );
    }
    if (role === "vision") {
      writeLine(output, "vision role 只输出 VisionObservation evidence，不写代码、不执行 Bash。");
    }
    if (role === "image") {
      writeLine(output, "image role 只生成本地资产路径和 evidence，不改代码、不执行 Bash。");
    }
    return;
  }
  writeLine(output, "用法：/model route | /model route doctor | /model route set <role> <model>");
}
