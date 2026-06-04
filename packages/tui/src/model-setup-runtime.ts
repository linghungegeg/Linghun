/**
 * Model setup wizard helpers: parsing, validation, step sequencing, and formatting.
 * Pure functions with no IO, no TuiContext mutation.
 * Extracted from index.ts (Slice D.10E) — behavior-preserving move only.
 */
import type { ProviderEnvSetup } from "@linghun/config";
import { validateProviderEnvSetup } from "@linghun/config";
import type { Language } from "@linghun/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelSetupStep = "baseUrl" | "apiKey" | "model" | "reasoning" | "auxModel" | "confirm";

export type PendingModelSetup = {
  step: ModelSetupStep;
  providerEnvPath: string;
  createdTemplate: boolean;
  values: Partial<ProviderEnvSetup>;
};

export type ModelSetupPrefill = Partial<ProviderEnvSetup>;

export type ModelSetupMessageKey =
  | "intro"
  | "baseUrlPrompt"
  | "apiKeyPrompt"
  | "modelPrompt"
  | "reasoningPrompt"
  | "auxModelPrompt"
  | "confirmPrompt"
  | "cancelled"
  | "details";

// ---------------------------------------------------------------------------
// Step sequencing
// ---------------------------------------------------------------------------

export function getNextModelSetupStep(values: Partial<ProviderEnvSetup>): ModelSetupStep {
  if (!values.baseUrl) return "baseUrl";
  if (!values.apiKey) return "apiKey";
  if (!values.model) return "model";
  if (!values.reasoningLevel) return "reasoning";
  return "confirm";
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseModelSetupPrefill(text: string): ModelSetupPrefill {
  const prefill: ModelSetupPrefill = {};
  const url = text.match(/https?:\/\/[^\s，,]+/iu)?.[0];
  if (url) prefill.baseUrl = url;

  const model =
    text.match(/(?:^|[\s，,;；])model(?:\s*[=:：]\s*|\s+)([^\s，,;；]+)/iu)?.[1] ??
    text.match(/(?:^|[\s，,;；])模型(?:\s*[=:：]\s*|\s+)([^\s，,;；]+)/iu)?.[1];
  if (model) prefill.model = model;

  const reasoning = text.match(
    /(?:reasoning|推理等级|推理)\s*[=:：]?\s*(Low|Medium|High|低|中|高)/iu,
  )?.[1];
  if (reasoning) prefill.reasoningLevel = normalizeModelSetupReasoningLevel(reasoning);

  const key =
    text.match(/(?:api\s*key|apikey|key|密钥)\s*[=:：]?\s*([^\s，,;；]+)/iu)?.[1] ??
    text.match(/\b(sk-[A-Za-z0-9._-]{8,})\b/u)?.[1];
  if (key) prefill.apiKey = key;

  return prefill;
}

export function normalizeModelSetupReasoningLevel(value: string): "Low" | "Medium" | "High" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "低") return "Low";
  if (normalized === "high" || normalized === "高") return "High";
  return "Medium";
}

export function looksLikeModelSetupInput(text: string): boolean {
  const prefill = parseModelSetupPrefill(text);
  if (/正常|状态|doctor|检查|诊断|怎么样|是否|吗|\?|？/iu.test(text)) {
    return Object.keys(prefill).length > 0;
  }
  return (
    /配置.*(?:模型|api\s*key|key|provider|供应商)|设置.*(?:模型|api\s*key|key|provider|供应商)|我要配置模型|configure\s+(?:model|provider|api\s*key)|setup\s+(?:model|provider)|model\s+setup|api\s*key|apikey/iu.test(
      text,
    ) || Object.keys(prefill).length > 0
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function applyModelSetupValues(setup: PendingModelSetup, values: ModelSetupPrefill): void {
  const next = { ...setup.values, ...values };
  validateModelSetupPartial(next);
  setup.values = next;
}

export function validateModelSetupPartial(values: Partial<ProviderEnvSetup>): void {
  validateProviderEnvSetup({
    baseUrl: values.baseUrl ?? "https://example.com/v1",
    apiKey: values.apiKey ?? "temporary-validation-key",
    model: values.model ?? "temporary-model",
    reasoningLevel: values.reasoningLevel ?? "Medium",
    endpointProfile: values.endpointProfile,
    includeUsage: values.includeUsage,
    auxModel: values.auxModel,
  });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function getModelSetupPromptMessage(setup: PendingModelSetup, language: Language): string {
  const keyByStep: Record<ModelSetupStep, ModelSetupMessageKey> = {
    baseUrl: "baseUrlPrompt",
    apiKey: "apiKeyPrompt",
    model: "modelPrompt",
    reasoning: "reasoningPrompt",
    auxModel: "auxModelPrompt",
    confirm: "confirmPrompt",
  };
  return formatModelSetupMessage(keyByStep[setup.step], language, setup);
}

export function formatModelSetupMessage(
  key: ModelSetupMessageKey,
  language: Language,
  setup: PendingModelSetup,
): string {
  const english = language === "en-US";
  const messagesByKey: Record<ModelSetupMessageKey, string> = {
    intro: english
      ? [
          "Model setup wizard",
          "- One-time setup for this computer; other repositories will reuse the same user provider.env.",
          "- API key is saved in the private user provider.env, never in project .linghun/settings.json.",
          `- Save location: ${setup.providerEnvPath}`,
          setup.createdTemplate ? "- A commented template was created for manual edits later." : "",
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "模型配置向导",
          "- 这是本机一次配置；配置后其他仓库会默认复用同一个用户 provider.env。",
          "- API key 会写入本机用户私密 provider.env，不会写入项目 .linghun/settings.json。",
          `- 写入位置：${setup.providerEnvPath}`,
          setup.createdTemplate ? "- 已创建带注释模板，后续可直接编辑这个文件。" : "",
        ]
          .filter(Boolean)
          .join("\n"),
    baseUrlPrompt: english
      ? "API base URL is missing. Enter the root API URL, for example https://example.com/v1."
      : "缺少 API 地址。请输入 root API 地址，例如 https://example.com/v1。",
    apiKeyPrompt: english
      ? "API key is missing. Enter it now; input is masked when possible and the raw value will not be printed."
      : "缺少 API key。请输入 API key（输入时会尽量 mask，不显示原值）。",
    modelPrompt: english
      ? "Model name is missing. Enter the model name."
      : "缺少模型名称。请输入模型名称。",
    reasoningPrompt: english
      ? "Reasoning level: Low / Medium / High. Press Enter to use Medium."
      : "推理等级可选 Low / Medium / High，默认 Medium。直接回车使用 Medium。",
    auxModelPrompt: english
      ? "Auxiliary model is optional. Press Enter to let helper roles follow the main model."
      : "辅助模型可选，直接回车则跟随主模型。",
    confirmPrompt: english
      ? "Type yes/save to save, no to cancel, or details for safety notes."
      : "请输入 yes 保存，no 取消，details 查看安全说明。",
    cancelled: english
      ? "Model setup cancelled. No key was saved."
      : "已取消模型配置，未保存任何 key。",
    details: english
      ? [
          "Safety notes",
          `- provider.env path: ${setup.providerEnvPath}`,
          "- Shell env has highest priority, then user provider.env, then existing settings/default.",
          "- The raw key is not displayed and is not written to project settings, docs, reports, or logs.",
          "- Role routes can stay unset; they follow the main model by default.",
        ].join("\n")
      : [
          "安全说明",
          `- provider.env 路径：${setup.providerEnvPath}`,
          "- shell env 变量优先级最高，其次用户 provider.env，再走现有 settings/default。",
          "- 真实 key 不会显示、不写入项目 settings、不写入文档或报告。",
          "- 不设置角色路由也可以正常使用，角色默认跟随主模型。",
        ].join("\n"),
  };
  return messagesByKey[key];
}

export function formatModelSetupFallbackError(language: Language): string {
  return language === "en-US"
    ? "Validation failed. Complete the missing fields and try again."
    : "检查未通过，请补全缺失项。";
}

export function formatModelSetupSummary(setup: PendingModelSetup, language: Language): string {
  const english = language === "en-US";
  return [
    english ? "Model setup summary" : "模型配置摘要",
    "- provider openai-compatible",
    `- base URL ${setup.values.baseUrl ? "present" : "missing"}`,
    `- api key ${setup.values.apiKey ? "present" : "missing"}`,
    `- model ${setup.values.model ?? "missing"}`,
    `- reasoning level ${setup.values.reasoningLevel ?? "Medium"}`,
    `${english ? "- save location" : "- 写入位置"}：${setup.providerEnvPath}`,
    english
      ? "Type yes/save to save. The raw API key is not shown."
      : "请输入 yes/保存 确认后才会写入；摘要不会显示 key 原值。",
  ].join("\n");
}

export function formatModelSetupSaved(path: string, language: Language): string {
  return language === "en-US"
    ? [
        "Saved. Restart Linghun to use the new user provider config.",
        `- User provider.env: ${path}`,
        "- This is user-scoped and will be reused by other repositories by default.",
        "- To change API URL, key, or model later, run /model setup or edit provider.env.",
        "- Check configuration with /model doctor.",
      ].join("\n")
    : [
        "已保存，请重启 Linghun 后使用新的用户级 provider 配置。",
        `- 用户 provider.env：${path}`,
        "- 这是用户级配置，之后进入其他仓库会默认复用。",
        "- 后续想更换 API 地址、key 或模型名称，可运行 /model setup，或编辑上述 provider.env。",
        "- 检查配置可运行 /model doctor。",
      ].join("\n");
}
