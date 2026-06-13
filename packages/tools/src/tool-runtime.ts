import type { ToolContext, ToolName, ToolOutput, ToolPermissionSpec } from "./index.js";

export type ToolPermissionDecision =
  | { behavior: "allow"; reason: string }
  | { behavior: "deny"; reason: string }
  | { behavior: "passthrough"; reason: string };

export type ToolInterruptBehavior = "abortable" | "best-effort" | "not-supported";

export type ToolLifecycleMetadata = {
  enabled: boolean;
  destructive: boolean;
  interruptBehavior: ToolInterruptBehavior;
  maxResultSizeChars: number;
};

export type ToolDefinition<Input = unknown> = {
  name: ToolName;
  title: string;
  description: string;
  permission: ToolPermissionSpec;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  isLongRunning?: boolean;
  lifecycle: ToolLifecycleMetadata;
  validateInput(input: unknown): Input;
  call(input: Input, context: ToolContext): Promise<ToolOutput>;
  isReadOnlyTool(): boolean;
  isDestructive(): boolean;
  checkPermissions(input: Input, context: ToolContext): ToolPermissionDecision;
  userFacingName(): string;
  getToolUseSummary(input: Input): string;
  prompt(): string;
  getActivityDescription(input: Input): string;
};

export type ToolFactoryDefinition<Input = unknown> = Omit<
  ToolDefinition<Input>,
  | "isReadOnly"
  | "isConcurrencySafe"
  | "lifecycle"
  | "isReadOnlyTool"
  | "isDestructive"
  | "checkPermissions"
  | "userFacingName"
  | "getToolUseSummary"
  | "prompt"
  | "getActivityDescription"
> & {
  isReadOnly?: boolean;
  isConcurrencySafe?: boolean;
  lifecycle?: Partial<ToolLifecycleMetadata>;
  checkPermissions?: (input: Input, context: ToolContext) => ToolPermissionDecision;
  userFacingName?: () => string;
  getToolUseSummary?: (input: Input) => string;
  prompt?: () => string;
  getActivityDescription?: (input: Input) => string;
};

export function createTool<Input>(definition: ToolFactoryDefinition<Input>): ToolDefinition<Input> {
  const isReadOnly = definition.isReadOnly ?? false;
  const isConcurrencySafe = definition.isConcurrencySafe ?? false;
  const lifecycle = {
    enabled: definition.lifecycle?.enabled ?? true,
    destructive: definition.lifecycle?.destructive ?? false,
    interruptBehavior: definition.lifecycle?.interruptBehavior ?? "not-supported",
    maxResultSizeChars: definition.lifecycle?.maxResultSizeChars ?? 8_000,
  } satisfies ToolLifecycleMetadata;
  const permissionReason = definition.permission.reason;
  return {
    ...definition,
    isReadOnly,
    isConcurrencySafe,
    lifecycle,
    isReadOnlyTool: () => isReadOnly,
    isDestructive: () => lifecycle.destructive,
    checkPermissions:
      definition.checkPermissions ??
      (() =>
        isReadOnly
          ? { behavior: "allow", reason: permissionReason }
          : { behavior: "passthrough", reason: permissionReason }),
    userFacingName: definition.userFacingName ?? (() => definition.title),
    getToolUseSummary: definition.getToolUseSummary ?? (() => definition.description),
    prompt: definition.prompt ?? (() => `${definition.title}: ${definition.description}`),
    getActivityDescription: definition.getActivityDescription ?? (() => definition.description),
  };
}
