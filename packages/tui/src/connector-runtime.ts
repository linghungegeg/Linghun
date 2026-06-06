import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Writable } from "node:stream";
import type { Language } from "@linghun/shared";
import {
  type CapabilityAuth,
  type CapabilityDefinition,
  type CapabilityExecutionRequest,
  type CapabilityExecutionResult,
  type CapabilityPermission,
  type CapabilityProvider,
  type CapabilityTransport,
  registerCapability,
  registerCapabilityProvider,
  setCapabilityConnectionResolver,
  unregisterCapabilitiesByApp,
} from "./capability-runtime.js";
import { showCommandPanel } from "./command-panel-runtime.js";
import { ensureSession } from "./details-status-runtime.js";
import { budgetToolResultTranscriptContent } from "./evidence-runtime.js";
import { truncateDisplay, writeLine } from "./startup-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";

export type AppConnectorAuthConfig =
  | { type: "none" }
  | {
      type: "api_key" | "local_token";
      env?: string;
      projectConfigRef?: string;
      userConfigRef?: string;
      valueRef?: string;
    };

export type AppConnectorManifest = {
  appId: string;
  name: string;
  version: string;
  transport: CapabilityTransport;
  baseUrl?: string;
  auth: AppConnectorAuthConfig;
  capabilities: CapabilityDefinition[];
};

export type AppConnectorState = {
  appId: string;
  name: string;
  version: string;
  manifestPath: string;
  transport: CapabilityTransport;
  baseUrl?: string;
  auth: {
    type: AppConnectorAuthConfig["type"];
    source:
      | "none"
      | "shell-env"
      | "project-config-ref"
      | "user-config-ref"
      | "manifest-ref"
      | "missing";
  };
  status: "connected" | "disconnected" | "error";
  capabilityIds: string[];
  connectedAt: string;
  lastError?: string;
};

export type AppConnectorConnectionResult =
  | { ok: true; state: AppConnectorState; capabilityCount: number }
  | { ok: false; error: string };

export type AppConnectorDoctorResult = {
  apps: AppConnectorState[];
};

type ConnectorRuntimeState = {
  apps: Map<string, AppConnectorState>;
  authConfigs: Map<string, AppConnectorAuthConfig>;
};

type ResolvedAuth = AppConnectorState["auth"] & { value?: string };

const HTTP_TIMEOUT_MS = 5_000;
const runtimeByProject = new Map<string, ConnectorRuntimeState>();

function getRuntimeState(context: TuiContext): ConnectorRuntimeState {
  let state = runtimeByProject.get(context.projectPath);
  if (!state) {
    state = { apps: new Map(), authConfigs: new Map() };
    runtimeByProject.set(context.projectPath, state);
  }
  return state;
}

export function listAppConnectors(context: TuiContext): AppConnectorState[] {
  return [...getRuntimeState(context).apps.values()].sort((a, b) => a.appId.localeCompare(b.appId));
}

export async function connectAppConnector(
  manifestPath: string,
  context: TuiContext,
): Promise<AppConnectorConnectionResult> {
  const manifest = await readConnectorManifest(manifestPath);
  if (!manifest.ok) return manifest;
  const auth = resolveConnectorAuth(manifest.value.auth, context);
  if (auth.type !== "none" && !auth.value) {
    return { ok: false, error: `auth ${auth.type} is missing; source=${auth.source}` };
  }
  if (manifest.value.transport !== "http") {
    return {
      ok: false,
      error: `transport ${manifest.value.transport} is reserved; Phase 7.15 only connects Local HTTP.`,
    };
  }
  if (!manifest.value.baseUrl) {
    return { ok: false, error: "HTTP connector requires baseUrl." };
  }
  const remote = await fetchConnectorJson(
    manifest.value.baseUrl,
    "/linghun/capabilities",
    "GET",
    auth,
  );
  if (!remote.ok) return { ok: false, error: remote.error };
  const remoteCapabilities = parseRemoteCapabilities(remote.value, manifest.value);
  if (!remoteCapabilities.ok) return { ok: false, error: remoteCapabilities.error };

  const merged = mergeCapabilities(manifest.value.capabilities, remoteCapabilities.value);
  const state: AppConnectorState = {
    appId: manifest.value.appId,
    name: manifest.value.name,
    version: manifest.value.version,
    manifestPath,
    transport: manifest.value.transport,
    baseUrl: manifest.value.baseUrl,
    auth: { type: auth.type, source: auth.source },
    status: "connected",
    capabilityIds: merged.map((item) => item.id),
    connectedAt: new Date().toISOString(),
  };
  disconnectAppConnector(manifest.value.appId, context);
  for (const capability of merged) {
    registerCapability(
      {
        ...capability,
        appId: manifest.value.appId,
        transport: "http",
        auth: manifest.value.auth.type,
      },
      { projectPath: context.projectPath },
    );
  }
  const runtime = getRuntimeState(context);
  runtime.apps.set(manifest.value.appId, state);
  runtime.authConfigs.set(manifest.value.appId, manifest.value.auth);
  return { ok: true, state, capabilityCount: state.capabilityIds.length };
}

export function disconnectAppConnector(appId: string, context: TuiContext): boolean {
  const state = getRuntimeState(context);
  const existed = state.apps.delete(appId);
  state.authConfigs.delete(appId);
  unregisterCapabilitiesByApp(appId, { projectPath: context.projectPath });
  return existed;
}

export function formatAppConnectorList(context: TuiContext): string {
  const apps = listAppConnectors(context);
  if (apps.length === 0) return "Apps\n- 尚未连接 app。";
  return ["Apps", ...apps.map((app) => formatAppSummary(app))].join("\n");
}

export function formatAppConnectorDoctor(
  context: TuiContext,
  language: Language = "zh-CN",
): string {
  const apps = listAppConnectors(context);
  const isEn = language === "en-US";
  if (apps.length === 0) {
    return isEn ? "Apps doctor\n- No app connected." : "Apps doctor\n- 尚未连接 app。";
  }
  return [
    "Apps doctor",
    ...apps.map(
      (app) =>
        `- ${app.name}: ${app.status}; transport=${app.transport}; auth=${app.auth.type}; authSource=${app.auth.source}; capabilities=${app.capabilityIds.length}`,
    ),
    "",
    "Details",
    ...apps.map(
      (app) =>
        `- appId=${app.appId}; baseUrl=${redactBaseUrl(app.baseUrl)}; capabilities=${app.capabilityIds.join(", ")}`,
    ),
  ].join("\n");
}

export async function handleAppsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "list";
  if (action === "list") {
    showCommandPanel(context, output, {
      title: "/apps",
      tone: "neutral",
      summary: formatAppConnectorList(context).split("\n"),
      actions: ["/apps connect <manifestPath>", "/apps doctor", "/apps disconnect <appId>"],
      detailsText: formatAppConnectorList(context),
    });
    return;
  }
  if (action === "doctor") {
    const body = formatAppConnectorDoctor(context, context.language);
    showCommandPanel(context, output, {
      title: "/apps doctor",
      tone: "neutral",
      summary: body.split("\n").slice(0, 6),
      actions: ["/apps list", "/apps disconnect <appId>"],
      detailsText: body,
    });
    return;
  }
  if (action === "connect") {
    const manifestPath = args.slice(1).join(" ");
    if (!manifestPath) {
      writeLine(output, "用法：/apps connect <manifestPath>");
      return;
    }
    const result = await connectAppConnector(manifestPath, context);
    if (!result.ok) {
      writeLine(output, `App connect 失败：${sanitizeConnectorText(result.error)}`);
      return;
    }
    writeLine(
      output,
      `已连接 ${result.state.name}；注册 capability ${result.capabilityCount} 个；写入/外部 app 操作会走权限确认。`,
    );
    return;
  }
  if (action === "disconnect") {
    const appId = args[1];
    if (!appId) {
      writeLine(output, "用法：/apps disconnect <appId>");
      return;
    }
    const removed = disconnectAppConnector(appId, context);
    writeLine(output, removed ? `已断开 ${appId}。` : `未找到已连接 app：${appId}`);
    return;
  }
  writeLine(
    output,
    "用法：/apps list | /apps connect <manifestPath> | /apps doctor | /apps disconnect <appId>",
  );
}

async function readConnectorManifest(
  manifestPath: string,
): Promise<{ ok: true; value: AppConnectorManifest } | { ok: false; error: string }> {
  let raw = "";
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    return { ok: false, error: `cannot read manifest: ${formatUnknownError(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `manifest JSON invalid: ${formatUnknownError(error)}` };
  }
  return parseConnectorManifest(parsed);
}

function parseConnectorManifest(
  input: unknown,
): { ok: true; value: AppConnectorManifest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "manifest must be an object." };
  const appId = readNonEmptyString(input, "appId");
  const name = readNonEmptyString(input, "name");
  const version = readNonEmptyString(input, "version");
  const transport = readNonEmptyString(input, "transport");
  const auth = parseAuthConfig(input.auth);
  if (!appId.ok) return appId;
  if (!name.ok) return name;
  if (!version.ok) return version;
  if (!transport.ok) return transport;
  if (!isCapabilityTransport(transport.value)) return { ok: false, error: "transport is invalid." };
  if (!auth.ok) return auth;
  const baseUrl = input.baseUrl === undefined ? undefined : readNonEmptyString(input, "baseUrl");
  if (baseUrl && !baseUrl.ok) return baseUrl;
  if (!Array.isArray(input.capabilities)) {
    return { ok: false, error: "capabilities must be an array." };
  }
  const capabilities: CapabilityDefinition[] = [];
  for (const item of input.capabilities) {
    const parsed = parseCapabilityDefinition(item, appId.value, transport.value, auth.value.type);
    if (!parsed.ok) return parsed;
    capabilities.push(parsed.value);
  }
  if (capabilities.length === 0) {
    return { ok: false, error: "capabilities must contain at least one capability." };
  }
  return {
    ok: true,
    value: {
      appId: appId.value,
      name: name.value,
      version: version.value,
      transport: transport.value,
      baseUrl: baseUrl?.value,
      auth: auth.value,
      capabilities,
    },
  };
}

function parseAuthConfig(
  input: unknown,
): { ok: true; value: AppConnectorAuthConfig } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "auth must be an object." };
  const type = input.type;
  if (type === "none") return { ok: true, value: { type } };
  if (type !== "api_key" && type !== "local_token") {
    return { ok: false, error: "auth.type is invalid." };
  }
  const config: AppConnectorAuthConfig = { type };
  for (const key of ["env", "projectConfigRef", "userConfigRef", "valueRef"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      return { ok: false, error: `auth.${key} must be a non-empty string.` };
    }
    config[key] = value.trim();
  }
  if (looksLikeRawSecret(input.value)) {
    return {
      ok: false,
      error: "auth.value is not allowed; use env/projectConfigRef/userConfigRef.",
    };
  }
  return { ok: true, value: config };
}

function parseCapabilityDefinition(
  input: unknown,
  appId: string,
  transport: CapabilityTransport,
  auth: CapabilityAuth,
): { ok: true; value: CapabilityDefinition } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "capability must be an object." };
  const id = readNonEmptyString(input, "id");
  const title = readNonEmptyString(input, "title");
  const description = readNonEmptyString(input, "description");
  const category = readNonEmptyString(input, "category");
  const permission = input.permission;
  const riskLevel = input.riskLevel;
  if (!id.ok) return id;
  if (!title.ok) return title;
  if (!description.ok) return description;
  if (!category.ok) return category;
  if (!isCapabilityPermission(permission))
    return { ok: false, error: "capability.permission is invalid." };
  if (riskLevel !== "low" && riskLevel !== "medium" && riskLevel !== "high") {
    return { ok: false, error: "capability.riskLevel is invalid." };
  }
  return {
    ok: true,
    value: {
      id: id.value,
      appId,
      title: title.value,
      description: description.value,
      category: category.value,
      intents: readStringArray(input.intents),
      keywords: readStringArray(input.keywords),
      transport,
      auth,
      permission,
      riskLevel,
      inputSchema: isRecord(input.inputSchema) ? input.inputSchema : { type: "object" },
      outputSchema: isRecord(input.outputSchema) ? input.outputSchema : { type: "object" },
      supportsRollback: input.supportsRollback === true,
      supportsPreview: input.supportsPreview === true,
    },
  };
}

function resolveConnectorAuth(auth: AppConnectorAuthConfig, context: TuiContext): ResolvedAuth {
  if (auth.type === "none") return { type: "none", source: "none" };
  if (auth.env) {
    const value = process.env[auth.env];
    if (value) return { type: auth.type, source: "shell-env", value };
  }
  if (auth.projectConfigRef) {
    const value = readConfigRef(context.config, auth.projectConfigRef);
    if (value) return { type: auth.type, source: "project-config-ref", value };
  }
  if (auth.userConfigRef) {
    const value = readConfigRef(context.config, auth.userConfigRef);
    if (value) return { type: auth.type, source: "user-config-ref", value };
  }
  if (auth.valueRef) {
    const value = readValueRef(auth.valueRef, context);
    if (value) return { type: auth.type, source: "manifest-ref", value };
  }
  return { type: auth.type, source: "missing" };
}

function readValueRef(ref: string, context: TuiContext): string | undefined {
  if (ref.startsWith("env:")) {
    return process.env[ref.slice("env:".length)];
  }
  if (ref.startsWith("settings.")) {
    return readConfigRef(context.config, ref);
  }
  return undefined;
}

function readConfigRef(config: unknown, ref: string): string | undefined {
  if (!ref.startsWith("settings.")) return undefined;
  let cursor: unknown = config;
  for (const part of ref.slice("settings.".length).split(".")) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return typeof cursor === "string" && cursor ? cursor : undefined;
}

async function fetchConnectorJson(
  baseUrl: string,
  path: string,
  method: "GET" | "POST",
  auth: ResolvedAuth,
  body?: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const url = buildConnectorUrl(baseUrl, path);
  if (!url.ok) return url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (method === "POST") headers["content-type"] = "application/json";
    if (auth.value) headers.authorization = `Bearer ${auth.value}`;
    const response = await fetch(url.value, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} from connector ${safeUrlLabel(url.value)}`,
      };
    }
    try {
      return { ok: true, value: text ? JSON.parse(text) : {} };
    } catch {
      return { ok: false, error: "connector response is not valid JSON." };
    }
  } catch (error) {
    return { ok: false, error: `connector unreachable: ${formatUnknownError(error)}` };
  } finally {
    clearTimeout(timeout);
  }
}

function buildConnectorUrl(
  baseUrl: string,
  path: string,
): { ok: true; value: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, error: "baseUrl is invalid." };
  }
  if (url.protocol !== "http:") {
    return { ok: false, error: "Phase 7.15 Local HTTP connector only supports http:// baseUrl." };
  }
  if (!isLocalHost(url.hostname)) {
    return { ok: false, error: "Local HTTP connector requires localhost/127.0.0.1/[::1]." };
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
  url.search = "";
  url.hash = "";
  return { ok: true, value: url.toString() };
}

function parseRemoteCapabilities(
  input: unknown,
  manifest: AppConnectorManifest,
): { ok: true; value: CapabilityDefinition[] } | { ok: false; error: string } {
  const raw = isRecord(input) && Array.isArray(input.capabilities) ? input.capabilities : input;
  if (!Array.isArray(raw)) return { ok: false, error: "remote capabilities response is invalid." };
  const capabilities: CapabilityDefinition[] = [];
  for (const item of raw) {
    const parsed = parseCapabilityDefinition(item, manifest.appId, "http", manifest.auth.type);
    if (!parsed.ok) return parsed;
    capabilities.push(parsed.value);
  }
  return { ok: true, value: capabilities };
}

function mergeCapabilities(
  manifestCapabilities: CapabilityDefinition[],
  remoteCapabilities: CapabilityDefinition[],
): CapabilityDefinition[] {
  const byId = new Map<string, CapabilityDefinition>();
  for (const capability of manifestCapabilities) byId.set(capability.id, capability);
  for (const capability of remoteCapabilities) {
    byId.set(capability.id, { ...byId.get(capability.id), ...capability });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function executeHttpCapability(
  definition: CapabilityDefinition,
  request: CapabilityExecutionRequest,
  context: TuiContext,
): Promise<CapabilityExecutionResult> {
  const app = getRuntimeState(context).apps.get(definition.appId);
  if (!app || app.status !== "connected" || !app.baseUrl) {
    return buildConnectorExecutionResult(definition, "Connector is not connected.", false);
  }
  const auth = resolveConnectorAuthForState(app, context);
  if (auth.type !== "none" && !auth.value) {
    return buildConnectorExecutionResult(
      definition,
      `Connector auth missing; source=${auth.source}.`,
      false,
    );
  }
  const response = await fetchConnectorJson(app.baseUrl, "/linghun/execute", "POST", auth, {
    capabilityId: definition.id,
    input: request.input,
    metadata: {
      requestId: randomUUID(),
      source: request.source,
      appId: definition.appId,
    },
  });
  if (!response.ok) return buildConnectorExecutionResult(definition, response.error, false);
  return normalizeHttpExecutionResult(definition, response.value, context);
}

function resolveConnectorAuthForState(app: AppConnectorState, context: TuiContext): ResolvedAuth {
  if (app.auth.type === "none") return { type: "none", source: "none" };
  const manifestAuth = getRuntimeState(context).authConfigs.get(app.appId);
  return resolveConnectorAuth(manifestAuth ?? { type: app.auth.type }, context);
}

async function normalizeHttpExecutionResult(
  definition: CapabilityDefinition,
  input: unknown,
  context: TuiContext,
): Promise<CapabilityExecutionResult> {
  if (!isRecord(input)) {
    return buildConnectorExecutionResult(
      definition,
      "Connector execute response is invalid.",
      false,
    );
  }
  const ok = input.ok !== false;
  const summary =
    typeof input.summary === "string" && input.summary.trim()
      ? truncateDisplay(sanitizeConnectorText(input.summary), 240)
      : ok
        ? "HTTP capability succeeded."
        : "HTTP capability failed.";
  const sessionId = await ensureSession(context);
  const artifactRef = await resolveConnectorArtifactRef(definition, input, context, sessionId);
  return {
    ok,
    capabilityId: definition.id,
    summary,
    details:
      typeof input.details === "string"
        ? truncateDisplay(sanitizeConnectorText(input.details), 1_000)
        : "Connector response normalized; raw response omitted.",
    artifactRef,
    rollbackRef: typeof input.rollbackRef === "string" ? input.rollbackRef : undefined,
    previewRef: typeof input.previewRef === "string" ? input.previewRef : undefined,
    metadata: {
      transport: definition.transport,
      auth: definition.auth,
      permission: definition.permission,
      riskLevel: definition.riskLevel,
      connectionStatus: "connected",
    },
  };
}

async function resolveConnectorArtifactRef(
  definition: CapabilityDefinition,
  response: Record<string, unknown>,
  context: TuiContext,
  sessionId: string,
): Promise<string | undefined> {
  if (typeof response.artifactRef === "string" && response.artifactRef.trim()) {
    return response.artifactRef;
  }
  const rawOutput = response.output ?? response.result ?? response.data;
  if (rawOutput === undefined) return undefined;
  const text = stringifyForBudget(rawOutput);
  if (!text) return undefined;
  const budgeted = await budgetToolResultTranscriptContent(
    context,
    sessionId,
    `connector-${definition.id}`,
    text,
  );
  if (typeof budgeted !== "string" || !budgeted.startsWith("<persisted-tool-result>")) {
    return undefined;
  }
  const artifact = context.evidence.find((item) =>
    item.supportsClaims.includes(`toolUseId:connector-${definition.id}`),
  );
  return artifact?.fullOutputPath ?? artifact?.outputPath;
}

function buildConnectorExecutionResult(
  definition: CapabilityDefinition,
  summary: string,
  ok: boolean,
): CapabilityExecutionResult {
  return {
    ok,
    capabilityId: definition.id,
    summary: sanitizeConnectorText(summary),
    metadata: {
      transport: definition.transport,
      auth: definition.auth,
      permission: definition.permission,
      riskLevel: definition.riskLevel,
      connectionStatus: ok ? "connected" : "not_connected",
    },
  };
}

function formatAppSummary(app: AppConnectorState): string {
  return `- ${app.name}: ${app.status}; transport=${app.transport}; capabilities=${app.capabilityIds.length}`;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === "object" && !Array.isArray(input));
}

function readNonEmptyString(
  input: Record<string, unknown>,
  key: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: `${key} must be a non-empty string.` };
  }
  return { ok: true, value: value.trim() };
}

function readStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function isCapabilityTransport(input: unknown): input is CapabilityTransport {
  return (
    input === "mock" ||
    input === "mcp" ||
    input === "plugin" ||
    input === "desktop_bridge" ||
    input === "http" ||
    input === "websocket"
  );
}

function isCapabilityPermission(input: unknown): input is CapabilityPermission {
  return (
    input === "read" ||
    input === "write" ||
    input === "bash" ||
    input === "network" ||
    input === "external_app"
  );
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function looksLikeRawSecret(input: unknown): boolean {
  return typeof input === "string" && input.trim().length > 0;
}

function stringifyForBudget(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return undefined;
  }
}

function sanitizeConnectorText(input: string): string {
  return input
    .replace(
      /(api[_-]?key|apiKey|token|Authorization)(\s*[:=]\s*)(Bearer\s+)?[^\s;&,)}\]]+/giu,
      "$1$2***",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***");
}

function redactBaseUrl(baseUrl: string | undefined): string {
  if (!baseUrl) return "none";
  const parsed = buildConnectorUrl(baseUrl, "");
  if (!parsed.ok) return "invalid";
  const url = new URL(parsed.value);
  return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}/...`;
}

function safeUrlLabel(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}/${basename(parsed.pathname)}`;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

registerCapabilityProvider({
  transport: "http",
  execute: executeHttpCapability,
} satisfies CapabilityProvider);

setCapabilityConnectionResolver((definition, context) => {
  if (definition.transport !== "http" || !context) return undefined;
  const app = getRuntimeState(context).apps.get(definition.appId);
  if (!app) return undefined;
  return {
    capabilityId: definition.id,
    transport: "http",
    status: app.status === "connected" ? "connected" : "not_connected",
    summary: app.status === "connected" ? `connected app ${app.name}` : "connector disconnected",
  };
});
