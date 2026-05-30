import type { Writable } from "node:stream";
import { ensureProviderEnvTemplate, getProviderEnvPath, loadConfig, providerEnvExists, saveModelRoute, saveProviderEnvSetup, type ModelRole, type ProviderEnvSetup } from "@linghun/config";
import type { TuiContext } from "./index.js";
import { showCommandPanel } from "./command-panel-runtime.js";
import { formatModelRouteDoctor, formatModelRouteSummary, formatModelRoutes, getRoleRoute, isModelRole } from "./model-doctor-runtime.js";
import { applyModelSetupValues, formatModelSetupFallbackError, formatModelSetupMessage, formatModelSetupSaved, formatModelSetupSummary, getModelSetupPromptMessage, getNextModelSetupStep, normalizeModelSetupReasoningLevel, parseModelSetupPrefill, type ModelSetupPrefill } from "./model-setup-runtime.js";
import { snapshotDeferredToolsSummary, snapshotDiscoveredDeferredToolsSummary } from "./deferred-tools-catalog.js";
import { getSelectedModelRuntime, resolveInitialModel } from "./tui-model-runtime.js";
import { writeLine } from "./startup-runtime.js";

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
    writeLine(output, await formatModelRouteDoctor({ ...context, deferredToolsSummary: snapshotDeferredToolsSummary(context), discoveredDeferredToolsSummary: snapshotDiscoveredDeferredToolsSummary(context) }));
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
    writeLine(output, formatModelRoutes(context.config));
    return;
  }
  if (action === "doctor") {
    writeLine(output, await formatModelRouteDoctor({ ...context, deferredToolsSummary: snapshotDeferredToolsSummary(context), discoveredDeferredToolsSummary: snapshotDiscoveredDeferredToolsSummary(context) }));
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
