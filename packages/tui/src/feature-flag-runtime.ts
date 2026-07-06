import type { TuiContext } from "./index.js";

export type FeatureFlagName =
  | "experimentalDeferredSkillExecution"
  | "experimentalDeferredPluginExecution"
  | "localReplBridge"
  | "memoryIncludes"
  | "customKeybindings"
  | "compactReplacementProjection"
  | "compactTerminalVisibleProjection"
  | "compactRetainedBudget";

export type FeatureFlagState = Record<FeatureFlagName, boolean>;

export const DEFAULT_FEATURE_FLAGS: FeatureFlagState = {
  experimentalDeferredSkillExecution: false,
  experimentalDeferredPluginExecution: false,
  localReplBridge: true,
  memoryIncludes: true,
  customKeybindings: true,
  compactReplacementProjection: true,
  compactTerminalVisibleProjection: true,
  compactRetainedBudget: true,
};

export function getFeatureFlags(context?: Pick<TuiContext, "config">): FeatureFlagState {
  const raw = context?.config as { features?: Partial<Record<FeatureFlagName, unknown>> } | undefined;
  return {
    ...DEFAULT_FEATURE_FLAGS,
    ...(raw?.features ? parseFeatureFlags(raw.features) : {}),
    ...parseFeatureFlagEnv(),
  };
}

export function isFeatureEnabled(
  name: FeatureFlagName,
  context?: Pick<TuiContext, "config">,
): boolean {
  return getFeatureFlags(context)[name] === true;
}

export function formatFeatureFlags(flags: FeatureFlagState): string[] {
  return Object.entries(flags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, enabled]) => `- ${name}: ${enabled ? "enabled" : "disabled"}`);
}

function parseFeatureFlags(raw: Partial<Record<FeatureFlagName, unknown>>): Partial<FeatureFlagState> {
  const parsed: Partial<FeatureFlagState> = {};
  for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as FeatureFlagName[]) {
    if (typeof raw[key] === "boolean") parsed[key] = raw[key] as boolean;
  }
  return parsed;
}

function parseFeatureFlagEnv(): Partial<FeatureFlagState> {
  const raw = process.env.LINGHUN_FEATURE_FLAGS;
  if (!raw) return {};
  const flags: Partial<FeatureFlagState> = {};
  for (const item of raw.split(",")) {
    const [name, value] = item.split("=").map((part) => part.trim());
    if (!isFeatureFlagName(name)) continue;
    flags[name] = value === "1" || value === "true" || value === "on";
  }
  return flags;
}

function isFeatureFlagName(value: string | undefined): value is FeatureFlagName {
  return Boolean(value && value in DEFAULT_FEATURE_FLAGS);
}
