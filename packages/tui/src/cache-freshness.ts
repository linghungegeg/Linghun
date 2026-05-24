import { createHash } from "node:crypto";
import type { LinghunConfig } from "@linghun/config";
import type { CacheFreshness } from "@linghun/core";

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 12);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${key}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

export function createCacheFreshness(input: {
  systemPrompt: unknown;
  toolSchema: unknown;
  mcpToolList: unknown;
  model: string;
  provider: string;
  reasoningEffort?: unknown;
  projectRules?: unknown;
  memory?: unknown;
  compact?: unknown;
  plugins?: unknown;
  _precomputedToolSchemaHash?: string;
}): CacheFreshness {
  return {
    systemPromptHash: stableHash(input.systemPrompt),
    toolSchemaHash: input._precomputedToolSchemaHash ?? stableHash(input.toolSchema),
    mcpToolListHash: stableHash(input.mcpToolList),
    modelProviderHash: stableHash(`${input.provider}:${input.model}`),
    reasoningEffortHash: stableHash(input.reasoningEffort ?? "default"),
    projectRulesHash: stableHash(input.projectRules ?? "none"),
    memoryHash: stableHash(input.memory ?? "none"),
    compactHash: stableHash(input.compact ?? "none"),
    pluginListHash: stableHash(input.plugins ?? []),
    changedKeys: [],
  };
}

export function diffFreshness(
  previous: CacheFreshness | undefined,
  current: CacheFreshness,
): string[] {
  if (!previous) {
    return [];
  }
  const keys: (keyof CacheFreshness)[] = [
    "systemPromptHash",
    "toolSchemaHash",
    "mcpToolListHash",
    "modelProviderHash",
    "reasoningEffortHash",
    "projectRulesHash",
    "memoryHash",
    "compactHash",
    "pluginListHash",
  ];
  return keys.filter((key) => previous[key] !== current[key]);
}

export function createConfigFreshnessSummary(config: LinghunConfig): unknown {
  return {
    language: config.language,
    permission: config.permission,
    index: config.index,
    defaultModel: config.defaultModel,
    modelRoutes: config.modelRoutes,
    providers: Object.fromEntries(
      Object.entries(config.providers)
        .map(([id, provider]) => ({
          id,
          summary: {
            type: provider.type,
            model: provider.model,
            baseUrl: provider.baseUrl ? "configured" : "missing",
            apiKey: provider.apiKey ? "configured" : "missing",
            endpointProfile: provider.endpointProfile,
            compatibilityProfile: provider.compatibilityProfile,
            supportsTools: provider.supportsTools,
          },
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((entry) => [entry.id, entry.summary]),
    ),
  };
}
