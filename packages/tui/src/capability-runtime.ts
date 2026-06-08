import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Writable } from "node:stream";
import type { Language } from "@linghun/shared";
import type { ToolName } from "@linghun/tools";
import { showCommandPanel } from "./command-panel-runtime.js";
import { ensureSession } from "./details-status-runtime.js";
import {
  appendSystemEvent,
  budgetToolResultTranscriptContent,
  createEvidenceRecord,
  rememberEvidence,
} from "./evidence-runtime.js";
import { sanitizeDiagnosticText, truncateDisplay, writeLine } from "./startup-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { decidePermission } from "./tui-permission-runtime.js";

export type CapabilityTransport =
  | "mock"
  | "mcp"
  | "plugin"
  | "desktop_bridge"
  | "http"
  | "websocket";

export type CapabilityAuth = "none" | "api_key" | "local_token" | "oauth" | "pairing_code";

export type CapabilityPermission = "read" | "write" | "bash" | "network" | "external_app";

export type CapabilityDefinition = {
  id: string;
  appId: string;
  title: string;
  description: string;
  category: string;
  intents: string[];
  keywords: string[];
  transport: CapabilityTransport;
  auth: CapabilityAuth;
  permission: CapabilityPermission;
  riskLevel: "low" | "medium" | "high";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  supportsRollback: boolean;
  supportsPreview: boolean;
};

export type CapabilityExecutionRequest = {
  capabilityId: string;
  input: Record<string, unknown>;
  source: "slash" | "model" | "runtime";
};

export type CapabilityExecutionResult = {
  ok: boolean;
  capabilityId: string;
  summary: string;
  details?: string;
  artifactRef?: string;
  rollbackRef?: string;
  previewRef?: string;
  evidenceId?: string;
  metadata: {
    transport: CapabilityTransport;
    auth: CapabilityAuth;
    permission: CapabilityPermission;
    riskLevel: CapabilityDefinition["riskLevel"];
    connectionStatus: CapabilityConnection["status"];
  };
};

export type CapabilityConnection = {
  capabilityId: string;
  transport: CapabilityTransport;
  status: "connected" | "not_connected" | "unsupported" | "needs_configuration";
  summary: string;
};

export type CapabilityProvider = {
  transport: CapabilityTransport;
  execute(
    definition: CapabilityDefinition,
    request: CapabilityExecutionRequest,
    context: TuiContext,
  ): Promise<CapabilityExecutionResult>;
};

const TRANSPORT_PRIORITY: CapabilityTransport[] = [
  "desktop_bridge",
  "websocket",
  "http",
  "mcp",
  "plugin",
  "mock",
];

type CapabilityRegistryEntry = {
  definition: CapabilityDefinition;
  projectPath?: string;
};

const registry = new Map<string, CapabilityRegistryEntry[]>();
const providers = new Map<CapabilityTransport, CapabilityProvider>();
let externalConnectionResolver:
  | ((definition: CapabilityDefinition, context?: TuiContext) => CapabilityConnection | undefined)
  | undefined;

export function registerCapability(
  definition: CapabilityDefinition,
  options: { projectPath?: string } = {},
): void {
  const entries = registry.get(definition.id) ?? [];
  const next = entries.filter((entry) => entry.projectPath !== options.projectPath);
  next.push({ definition, projectPath: options.projectPath });
  registry.set(definition.id, next);
}

export function unregisterCapabilitiesByApp(
  appId: string,
  options: { projectPath?: string } = {},
): void {
  for (const [id, entries] of registry.entries()) {
    const next = entries.filter((entry) => {
      if (entry.definition.appId !== appId) return true;
      return options.projectPath !== undefined && entry.projectPath !== options.projectPath;
    });
    if (next.length === 0) {
      registry.delete(id);
    } else {
      registry.set(id, next);
    }
  }
}

export function listCapabilities(context?: TuiContext): CapabilityDefinition[] {
  return [...registry.values()]
    .map((entries) => selectCapabilityEntry(entries, context))
    .filter((entry): entry is CapabilityRegistryEntry => Boolean(entry))
    .map((entry) => entry.definition)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function findCapability(id: string, context?: TuiContext): CapabilityDefinition | undefined {
  const entries = registry.get(id);
  const entry = entries ? selectCapabilityEntry(entries, context) : undefined;
  if (!entry) return undefined;
  return entry.definition;
}

export function resolveCapabilityConnection(
  definition: CapabilityDefinition,
  context?: TuiContext,
): CapabilityConnection {
  const external = externalConnectionResolver?.(definition, context);
  if (external) return external;
  const transport = TRANSPORT_PRIORITY.includes(definition.transport)
    ? definition.transport
    : definition.transport;
  if (transport === "mock") {
    return {
      capabilityId: definition.id,
      transport,
      status: "connected",
      summary: "mock provider ready",
    };
  }
  const needsAuth = definition.auth !== "none";
  return {
    capabilityId: definition.id,
    transport,
    status: needsAuth ? "needs_configuration" : "not_connected",
    summary: needsAuth
      ? "connector reserved; auth is not configured in this MVP"
      : "connector reserved; no live connection in this MVP",
  };
}

export async function executeCapability(
  request: CapabilityExecutionRequest,
  context: TuiContext,
): Promise<CapabilityExecutionResult> {
  const definition = findCapability(request.capabilityId, context);
  if (!definition) {
    return {
      ok: false,
      capabilityId: request.capabilityId,
      summary: "Capability not found.",
      metadata: {
        transport: "mock",
        auth: "none",
        permission: "read",
        riskLevel: "low",
        connectionStatus: "unsupported",
      },
    };
  }
  const schemaError = validateCapabilityInput(definition, request.input);
  if (schemaError) {
    return buildFailedCapabilityResult(definition, schemaError, "unsupported");
  }
  const connection = resolveCapabilityConnection(definition, context);
  if (connection.status !== "connected") {
    return buildFailedCapabilityResult(definition, connection.summary, connection.status);
  }
  const permission = await checkCapabilityPermission(definition, request, context);
  if (permission.decision !== "allow") {
    return buildFailedCapabilityResult(
      definition,
      permission.decision === "deny"
        ? `Permission denied: ${permission.reason}`
        : `Permission required: ${permission.reason}`,
      connection.status,
    );
  }
  const provider = providers.get(definition.transport);
  if (!provider) {
    return buildFailedCapabilityResult(
      definition,
      "Capability provider unavailable.",
      "unsupported",
    );
  }
  const result = await provider.execute(definition, request, context);
  const sessionId = await ensureSession(context);
  const outcome = result.ok ? "succeeded" : "failed";
  const evidence = createEvidenceRecord(
    "command_output",
    `capability ${outcome} ${definition.id}: ${truncateDisplay(result.summary, 120)}`,
    `capability:${definition.id}`,
    [
      "capability_execution",
      definition.id,
      definition.permission,
      definition.transport,
      "not_verification_pass",
      result.ok ? "capability_success" : "capability_failure",
    ],
  );
  if (result.artifactRef) {
    evidence.fullOutputPath = result.artifactRef;
    evidence.outputPath = result.artifactRef;
  }
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  await appendSystemEvent(
    context,
    sessionId,
    [
      `capability ${outcome} id=${definition.id}`,
      `transport=${definition.transport}`,
      `permission=${definition.permission}`,
      `risk=${definition.riskLevel}`,
      `evidence=${evidence.id}`,
      result.artifactRef ? `artifact=${basename(result.artifactRef)}` : "artifact=none",
      "verification=not_pass",
    ].join(" "),
    result.ok ? "info" : "warning",
  );
  return {
    ...result,
    evidenceId: evidence.id,
    metadata: {
      ...result.metadata,
      connectionStatus: connection.status,
    },
  };
}

function capabilityEntryVisible(entry: CapabilityRegistryEntry, context?: TuiContext): boolean {
  if (!entry.projectPath) return true;
  return context?.projectPath === entry.projectPath;
}

function selectCapabilityEntry(
  entries: CapabilityRegistryEntry[],
  context?: TuiContext,
): CapabilityRegistryEntry | undefined {
  const projectEntry = context
    ? entries.find((entry) => entry.projectPath === context.projectPath)
    : undefined;
  if (projectEntry) return projectEntry;
  return entries.find((entry) => capabilityEntryVisible(entry, context));
}

export function formatCapabilityDoctor(language: Language = "zh-CN", context?: TuiContext): string {
  const isEn = language === "en-US";
  const lines = [
    isEn ? "Capability doctor" : "Capability doctor",
    isEn
      ? "- Runtime: Capability Runtime with mock provider and project-scoped Local HTTP connectors."
      : "- 运行时：Capability Runtime；mock provider 全局可用，Local HTTP connector 按项目隔离。",
  ];
  for (const item of listCapabilities(context)) {
    const connection = resolveCapabilityConnection(item, context);
    lines.push(
      sanitizeCapabilityDisplayText(
        `- ${item.id}: availability=${formatCapabilityAvailability(item, connection)}; ${connection.status}; transport=${item.transport}; auth=${item.auth}; permission=${item.permission}; ${connection.summary}`,
      ),
    );
  }
  return lines.join("\n");
}

function formatCapabilityAvailability(
  definition: CapabilityDefinition,
  connection: CapabilityConnection,
): string {
  if (connection.status === "unsupported") {
    return "not_implemented/unsupported (not a usable capability)";
  }
  if (definition.transport === "mock") {
    return "mock/demo (diagnostic only; not a real external capability)";
  }
  if (connection.status === "connected") {
    return "real/connected";
  }
  if (connection.status === "needs_configuration") {
    return "reserved/needs_configuration (not usable until configured)";
  }
  return "reserved/not_connected (not usable until connected)";
}

export function registerCapabilityProvider(provider: CapabilityProvider): void {
  providers.set(provider.transport, provider);
}

export function setCapabilityConnectionResolver(
  resolver: (
    definition: CapabilityDefinition,
    context?: TuiContext,
  ) => CapabilityConnection | undefined,
): void {
  externalConnectionResolver = resolver;
}

export function formatCapabilityList(language: Language = "zh-CN", context?: TuiContext): string {
  const isEn = language === "en-US";
  const lines = [isEn ? "Capabilities" : "Capabilities"];
  for (const item of listCapabilities(context)) {
    lines.push(sanitizeCapabilityDisplayText(`- ${item.title}: ${item.description}`));
  }
  lines.push(isEn ? "Details: /capabilities doctor" : "详情：/capabilities doctor");
  return lines.join("\n");
}

export function formatCapabilityResult(
  result: CapabilityExecutionResult,
  language: Language = "zh-CN",
): { summary: string[]; detailsText: string } {
  const isEn = language === "en-US";
  const summary = [
    sanitizeCapabilityDisplayText(result.summary),
    result.artifactRef
      ? isEn
        ? "Artifact ref recorded; use details to inspect it."
        : "Artifact ref 已记录；需要时看 details。"
      : isEn
        ? "No artifact was created."
        : "未创建 artifact。",
    result.ok
      ? isEn
        ? "Capability execution is not verification PASS."
        : "Capability execution 不等于验证通过。"
      : isEn
        ? "Capability failed; failure is not verification PASS."
        : "Capability failed；失败不等于验证通过。",
  ];
  const details = [
    `capability: ${result.capabilityId}`,
    `transport: ${result.metadata.transport}`,
    `auth: ${result.metadata.auth}`,
    `permission: ${result.metadata.permission}`,
    `risk: ${result.metadata.riskLevel}`,
    `connection: ${result.metadata.connectionStatus}`,
    result.evidenceId ? `evidence: ${result.evidenceId}` : undefined,
    result.artifactRef ? `artifact: ${result.artifactRef}` : undefined,
    result.rollbackRef ? `rollbackRef: ${result.rollbackRef}` : undefined,
    result.previewRef ? `previewRef: ${result.previewRef}` : undefined,
    result.details,
  ].filter((line): line is string => Boolean(line));
  return { summary, detailsText: sanitizeCapabilityDisplayText(details.join("\n")) };
}

export async function handleCapabilitiesCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "list";
  if (action === "list") {
    showCommandPanel(context, output, {
      title: "/capabilities",
      tone: "neutral",
      summary: formatCapabilityList(context.language, context).split("\n"),
      actions: ["/capabilities doctor", "/capabilities run <capabilityId> <json>"],
      detailsText: listCapabilities(context)
        .map((item) =>
          sanitizeCapabilityDisplayText(
            `${item.id}\n- app: ${item.appId}\n- transport: ${item.transport}\n- auth: ${item.auth}\n- permission: ${item.permission}\n- risk: ${item.riskLevel}`,
          ),
        )
        .join("\n\n"),
    });
    return;
  }
  if (action === "doctor") {
    showCommandPanel(context, output, {
      title: "/capabilities doctor",
      tone: "neutral",
      summary: formatCapabilityDoctor(context.language, context).split("\n").slice(0, 6),
      actions: ["/capabilities list", "/capabilities run <capabilityId> <json>"],
      detailsText: formatCapabilityDoctor(context.language, context),
    });
    return;
  }
  if (action === "run") {
    const capabilityId = args[1];
    const json = args.slice(2).join(" ");
    if (!capabilityId || !json) {
      writeLine(output, "用法：/capabilities run <capabilityId> <json>");
      return;
    }
    const parsed = parseCapabilityInput(json);
    if (!parsed.ok) {
      writeLine(output, `Capability input JSON 无效：${parsed.error}`);
      return;
    }
    const result = await executeCapability(
      { capabilityId, input: parsed.value, source: "slash" },
      context,
    );
    const formatted = formatCapabilityResult(result, context.language);
    showCommandPanel(context, output, {
      title: "/capabilities run",
      tone: result.ok ? "neutral" : "warning",
      summary: formatted.summary,
      actions: ["/capabilities doctor", "/details evidence <id>"],
      detailsText: formatted.detailsText,
    });
    return;
  }
  writeLine(
    output,
    "用法：/capabilities list | /capabilities doctor | /capabilities run <capabilityId> <json>",
  );
}

function sanitizeCapabilityDisplayText(text: string): string {
  return sanitizeDiagnosticText(text)
    .replace(
      /(api[_-]?key|apiKey|token|Authorization)(\s*[:=]\s*)(Bearer\s+)?[^\s;&,)}\]]+/giu,
      "$1$2***",
    )
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***");
}

function parseCapabilityInput(
  json: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "input must be a JSON object" };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function validateCapabilityInput(
  definition: CapabilityDefinition,
  input: Record<string, unknown>,
): string | undefined {
  const required = definition.inputSchema.required;
  if (!Array.isArray(required)) return undefined;
  for (const key of required) {
    if (typeof key === "string" && !(key in input)) {
      return `Missing required input: ${key}`;
    }
  }
  return undefined;
}

async function checkCapabilityPermission(
  definition: CapabilityDefinition,
  request: CapabilityExecutionRequest,
  context: TuiContext,
) {
  const sessionId = await ensureSession(context);
  const toolName = capabilityPermissionToolName(definition.permission);
  return decidePermission(
    toolName,
    buildPermissionInput(definition, request.input, toolName),
    context,
    sessionId,
  );
}

function capabilityPermissionToolName(permission: CapabilityPermission): ToolName {
  if (permission === "read") return "Read";
  if (permission === "bash") return "Bash";
  if (permission === "network") return "Bash";
  return "Write";
}

function buildPermissionInput(
  definition: CapabilityDefinition,
  input: Record<string, unknown>,
  toolName: ToolName,
): unknown {
  if (toolName === "Read") {
    return { path: definition.id };
  }
  if (toolName === "Bash") {
    return {
      command:
        definition.permission === "network"
          ? `capability network ${definition.id}`
          : `capability bash ${definition.id}`,
    };
  }
  return {
    path: `.linghun/capabilities/${definition.id}.json`,
    content: JSON.stringify({ capabilityId: definition.id, inputKeys: Object.keys(input) }),
  };
}

function buildFailedCapabilityResult(
  definition: CapabilityDefinition,
  summary: string,
  status: CapabilityConnection["status"],
): CapabilityExecutionResult {
  return {
    ok: false,
    capabilityId: definition.id,
    summary,
    metadata: {
      transport: definition.transport,
      auth: definition.auth,
      permission: definition.permission,
      riskLevel: definition.riskLevel,
      connectionStatus: status,
    },
  };
}

registerCapabilityProvider({
  transport: "mock",
  async execute(definition, request, context) {
    if (definition.id === "mock.echo.read") {
      const text = typeof request.input.text === "string" ? request.input.text : "";
      return {
        ok: true,
        capabilityId: definition.id,
        summary: `Echo ready: ${truncateDisplay(text.replace(/\s+/g, " "), 120)}`,
        metadata: {
          transport: definition.transport,
          auth: definition.auth,
          permission: definition.permission,
          riskLevel: definition.riskLevel,
          connectionStatus: "connected",
        },
      };
    }
    if (definition.id === "mock.canvas.create") {
      const title = typeof request.input.title === "string" ? request.input.title : "Untitled";
      return {
        ok: true,
        capabilityId: definition.id,
        summary: `Canvas created: ${truncateDisplay(title, 80)}`,
        previewRef: `mock-preview:${randomUUID()}`,
        rollbackRef: `mock-rollback:${randomUUID()}`,
        metadata: {
          transport: definition.transport,
          auth: definition.auth,
          permission: definition.permission,
          riskLevel: definition.riskLevel,
          connectionStatus: "connected",
        },
      };
    }
    if (definition.id === "mock.canvas.export") {
      const payload = `mock canvas export\n${"x".repeat(60_000)}`;
      const sessionId = await ensureSession(context);
      const budgeted = await budgetToolResultTranscriptContent(
        context,
        sessionId,
        `capability-${definition.id}`,
        payload,
      );
      const artifact = context.evidence.find((item) =>
        item.supportsClaims.includes(`toolUseId:capability-${definition.id}`),
      );
      return {
        ok: true,
        capabilityId: definition.id,
        summary:
          typeof budgeted === "string" && budgeted.startsWith("<persisted-tool-result>")
            ? "Canvas export prepared; large output stored as artifact ref."
            : "Canvas export prepared.",
        artifactRef:
          artifact?.fullOutputPath ?? artifact?.outputPath ?? "mock-artifact:canvas-export",
        details: "Export payload is represented by summary plus artifact/ref only.",
        metadata: {
          transport: definition.transport,
          auth: definition.auth,
          permission: definition.permission,
          riskLevel: definition.riskLevel,
          connectionStatus: "connected",
        },
      };
    }
    return buildFailedCapabilityResult(
      definition,
      "Mock capability not implemented.",
      "unsupported",
    );
  },
});

registerCapability({
  id: "mock.echo.read",
  appId: "mock.echo",
  title: "Mock Echo Read",
  description: "Read-only echo capability for runtime checks.",
  category: "diagnostic",
  intents: ["echo", "read capability", "capability smoke"],
  keywords: ["echo", "read", "mock", "capability"],
  transport: "mock",
  auth: "none",
  permission: "read",
  riskLevel: "low",
  inputSchema: { type: "object", required: ["text"] },
  outputSchema: { type: "object", required: ["summary"] },
  supportsRollback: false,
  supportsPreview: false,
});

registerCapability({
  id: "mock.canvas.create",
  appId: "mock.canvas",
  title: "Mock Canvas Create",
  description: "Simulates creating a canvas in an external app.",
  category: "canvas",
  intents: ["create canvas", "draw", "external app"],
  keywords: ["canvas", "draw", "画布", "画图", "external app"],
  transport: "mock",
  auth: "none",
  permission: "external_app",
  riskLevel: "medium",
  inputSchema: { type: "object", required: ["title"] },
  outputSchema: { type: "object", required: ["summary"] },
  supportsRollback: true,
  supportsPreview: true,
});

registerCapability({
  id: "mock.canvas.export",
  appId: "mock.canvas",
  title: "Mock Canvas Export",
  description: "Simulates exporting a canvas artifact ref.",
  category: "canvas",
  intents: ["export canvas", "artifact", "external app"],
  keywords: ["canvas", "export", "artifact", "导出", "画布"],
  transport: "mock",
  auth: "none",
  permission: "external_app",
  riskLevel: "medium",
  inputSchema: { type: "object", required: ["format"] },
  outputSchema: { type: "object", required: ["summary", "artifactRef"] },
  supportsRollback: false,
  supportsPreview: false,
});
