import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

process.exitCode = await main();

async function main() {
  const providerEnv = await readProviderEnv();
  const openAiApiKey = envValue("LINGHUN_OPENAI_API_KEY", providerEnv);
  const deepSeekApiKey = envValue("LINGHUN_DEEPSEEK_API_KEY", providerEnv);
  const openAiModel = envValue("LINGHUN_OPENAI_MODEL", providerEnv);
  const deepSeekModel = envValue("LINGHUN_DEEPSEEK_MODEL", providerEnv);

  if (!deepSeekApiKey && !openAiApiKey) {
    console.log(
      "SKIPPED live provider smoke: set LINGHUN_DEEPSEEK_API_KEY or LINGHUN_OPENAI_API_KEY in shell env or private provider.env",
    );
    return 0;
  }

  if (openAiApiKey && !openAiModel) {
    console.error(
      "FAIL live provider smoke: LINGHUN_OPENAI_API_KEY is set but LINGHUN_OPENAI_MODEL is missing; set an explicit real model, no placeholder is used.",
    );
    return 1;
  }

  if (deepSeekApiKey && !openAiApiKey && !deepSeekModel) {
    console.error(
      "FAIL live provider smoke: LINGHUN_DEEPSEEK_API_KEY is set but LINGHUN_DEEPSEEK_MODEL is missing; set an explicit real model, no placeholder is used.",
    );
    return 1;
  }

  const {
    DeepSeekProvider,
    OpenAiCompatibleProvider,
    joinBaseUrlAndEndpoint,
    normalizeProviderError,
    resolveProviderBaseUrlDiagnostic,
    resolveProviderRuntimeContract,
  } = await import("../packages/providers/dist/index.js");

  const providerConfig = openAiApiKey
    ? {
        id: "openai-compatible",
        type: "openai-compatible",
        baseUrl: envValue("LINGHUN_OPENAI_BASE_URL", providerEnv),
        apiKey: openAiApiKey,
        model: openAiModel,
        endpointProfile: normalizeEndpointProfile(
          envValue("LINGHUN_OPENAI_ENDPOINT_PROFILE", providerEnv),
        ),
        reasoningLevel: normalizeReasoningLevel(envValue("LINGHUN_INFERENCE_LEVEL", providerEnv)),
        supportsTools: false,
      }
    : {
        id: "deepseek",
        type: "deepseek",
        baseUrl: envValue("LINGHUN_DEEPSEEK_BASE_URL", providerEnv),
        apiKey: deepSeekApiKey,
        model: deepSeekModel,
        supportsTools: false,
      };
  const provider = openAiApiKey
    ? new OpenAiCompatibleProvider(providerConfig)
    : new DeepSeekProvider(providerConfig);
  const contract = resolveProviderRuntimeContract(providerConfig);
  const diagnostic = resolveProviderBaseUrlDiagnostic(
    providerConfig.baseUrl,
    contract.endpointProfile,
  );
  const endpointPath =
    providerConfig.baseUrl && diagnostic.normalizedBaseUrl
      ? new URL(joinBaseUrlAndEndpoint(diagnostic.normalizedBaseUrl, contract.endpoint)).pathname
      : contract.endpoint;
  console.log(
    [
      "live provider route:",
      `provider=${providerConfig.id}`,
      `model=${providerConfig.model}`,
      `endpointProfile=${contract.endpointProfile}`,
      `endpointPath=${endpointPath}`,
      `reasoning=${contract.sendReasoning ? `sent level=${providerConfig.reasoningLevel ?? "request"}` : "not-sent"}`,
      `baseUrl=${providerConfig.baseUrl ? "present" : "missing"}`,
      `apiKey=${providerConfig.apiKey ? "present" : "missing"}`,
      `source=${openAiApiKey ? providerEnvSource("LINGHUN_OPENAI_API_KEY", providerEnv) : providerEnvSource("LINGHUN_DEEPSEEK_API_KEY", providerEnv)}`,
    ].join(" "),
  );

  let text = "";
  let tool = false;
  let hadReasoning = false;
  let eventCount = 0;
  let usageSeen = false;
  let finishReason = "";
  const maxOutputTokens = parseOptionalPositiveInt(
    envValue("LINGHUN_SMOKE_MAX_OUTPUT_TOKENS", providerEnv),
    "LINGHUN_SMOKE_MAX_OUTPUT_TOKENS",
  );
  if (maxOutputTokens === undefined && envValue("LINGHUN_SMOKE_MAX_OUTPUT_TOKENS", providerEnv)) {
    return 1;
  }

  try {
    const request = {
      messages: [{ role: "user", content: "用一句中文回复：Linghun live provider smoke" }],
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
    };
    for await (const event of provider.stream(
      request,
      new AbortController().signal,
    )) {
      eventCount += 1;
      if (event.type === "assistant_text_delta") text += event.text;
      if (event.type === "assistant_thinking_delta") hadReasoning = true;
      if (event.type === "tool_use") tool = true;
      if (event.type === "usage") usageSeen = true;
      if (event.type === "message_stop") finishReason = event.finishReason ?? "";
      if (event.type === "error") {
        printProviderFailure(event.error);
        return 1;
      }
    }
  } catch (error) {
    printProviderFailure(normalizeProviderError(error));
    return 1;
  }

  if (text) {
    console.log(formatSmokeResult("PASS live provider smoke: text response", {
      eventCount,
      usageSeen,
      finishReason,
      maxOutputTokens,
    }));
    return 0;
  }

  if (tool) {
    console.log(formatSmokeResult("PASS live provider smoke: tool response", {
      eventCount,
      usageSeen,
      finishReason,
      maxOutputTokens,
    }));
    return 0;
  }

  if (hadReasoning) {
    console.error(formatSmokeResult(
      "FAIL live provider smoke: reasoning stream observed but no final text",
      {
        eventCount,
        usageSeen,
        finishReason,
        maxOutputTokens,
      },
    ));
    console.error(
      "diagnosis: provider/model reached reasoning output but did not produce final assistant text; this is a smoke-harness/provider-output diagnostic, not proof that the Linghun main chain failed.",
    );
    return 1;
  }

  console.error(formatSmokeResult("FAIL live provider smoke: empty provider response", {
    eventCount,
    usageSeen,
    finishReason,
    maxOutputTokens,
  }));
  return 1;
}

function printProviderFailure(error) {
  console.error(`FAIL live provider smoke: ${error.code}: ${error.message}`);
  if (error.suggestion) {
    console.error(`suggestion: ${error.suggestion}`);
  }
}

async function readProviderEnv() {
  const configDir = process.env.LINGHUN_CONFIG_DIR;
  const dir = configDir ? configDir : join(homedir(), ".linghun");
  try {
    const raw = await readFile(join(dir, "provider.env"), "utf8");
    const values = {};
    for (const line of raw.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex <= 0) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      const value = trimmed.slice(equalsIndex + 1).trim();
      if (
        [
          "LINGHUN_OPENAI_BASE_URL",
          "LINGHUN_OPENAI_API_KEY",
          "LINGHUN_OPENAI_MODEL",
          "LINGHUN_OPENAI_ENDPOINT_PROFILE",
          "LINGHUN_INFERENCE_LEVEL",
          "LINGHUN_DEEPSEEK_BASE_URL",
          "LINGHUN_DEEPSEEK_API_KEY",
          "LINGHUN_DEEPSEEK_MODEL",
        ].includes(key)
      ) {
        values[key] = unquote(value);
      }
    }
    return values;
  } catch {
    return {};
  }
}

function envValue(key, providerEnv) {
  return process.env[key] || providerEnv[key] || "";
}

function providerEnvSource(key, providerEnv) {
  if (process.env[key]) return "shell-env";
  if (providerEnv[key]) return process.env.LINGHUN_CONFIG_DIR ? "config-dir-provider-env" : "user-provider-env";
  return "missing";
}

function parseOptionalPositiveInt(value, name) {
  if (!value) return undefined;
  if (!/^[1-9]\d*$/u.test(value.trim())) {
    console.error(`FAIL live provider smoke: ${name} must be a positive integer when set.`);
    return undefined;
  }
  return Number(value.trim());
}

function formatSmokeResult(prefix, details) {
  return [
    prefix,
    `events=${details.eventCount}`,
    `usage=${details.usageSeen ? "reported" : "missing"}`,
    `finishReason=${details.finishReason || "unknown"}`,
    `maxOutputTokens=${details.maxOutputTokens ? "explicit" : "provider-default"}`,
  ].join(" ");
}

function normalizeEndpointProfile(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) return "chat_completions";
  if (["chat_completions", "responses", "anthropic_messages"].includes(normalized)) {
    return normalized;
  }
  return "chat_completions";
}

function normalizeReasoningLevel(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "low") return "Low";
  if (normalized === "medium") return "Medium";
  if (normalized === "high") return "High";
  return undefined;
}

function unquote(value) {
  if (!value) return "";
  const quote = value[0];
  if ((quote === "'" || quote === '"') && value.endsWith(quote) && value.length > 1) {
    return value.slice(1, -1);
  }
  return value;
}
