// D.14E Remote Connect — real send transport.
//
// Pure, testable per-platform payload/signature builders plus injectable network
// and process delivery. Business logic only; index.ts stays composition/glue.
//
// Capability reality (official docs, 2026-05-31): all three group/custom-robot
// webhooks are NOTIFICATION-ONLY (outbound HTTP POST, cannot receive). Inbound
// approval / natural-language requires the official CLI / full app path. We never
// present a successful webhook POST as "can receive approvals back".
//
// Redaction: the webhook/CLI body content is always event.redactedSummary, which
// is already summary-only and stripped of secrets/transcripts/endpoints. The real
// endpoint URL (which may carry an access_token/key) and the resolved signing
// secret are used only for the live request — never persisted into deliveryDetail,
// transcript, or report.

import { execFile as nodeExecFile } from "node:child_process";
import { createHmac } from "node:crypto";
import type { RemoteChannelState, RemoteEvent } from "./tui-data-types.js";

const DEFAULT_WEBHOOK_TIMEOUT_MS = 8_000;
const DEFAULT_CLI_TIMEOUT_MS = 15_000;

export type RemoteWebhookRequest = {
  url: string;
  body: string;
};

export type RemoteWebhookBuild =
  | { ok: true; request: RemoteWebhookRequest }
  | { ok: false; reason: string };

export type RemoteCliBuild =
  | { ok: true; command: string; args: string[] }
  | { ok: false; reason: string };

export type RemoteDeliveryStatus = "sent" | "failed" | "blocked" | "mock";

export type RemoteDeliveryResult = {
  status: RemoteDeliveryStatus;
  detail: string;
};

// Injectable so tests never touch the real network/process.
export type RemoteFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; text: () => Promise<string> }>;

export type RemoteCliRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string }>;

export type RemoteSecretResolver = (ref: string) => string | undefined;

export type RemoteTransportDeps = {
  fetch: RemoteFetch;
  runCli: RemoteCliRunner;
  resolveSecret: RemoteSecretResolver;
  nowMs: () => number;
};

// ---------------------------------------------------------------------------
// Pure payload / signature builders
// ---------------------------------------------------------------------------

// Feishu/Lark custom-bot webhook. Body: {msg_type:"text",content:{text}}.
// Optional sign: base64(HMAC_SHA256(key = `${ts}\n${secret}`, msg = "")),
// ts = epoch seconds. Secret is the HMAC key over an empty message.
function buildFeishuWebhook(
  endpoint: string,
  content: string,
  signingSecret: string | undefined,
  nowMs: number,
): RemoteWebhookRequest {
  const payload: Record<string, unknown> = { msg_type: "text", content: { text: content } };
  if (signingSecret) {
    const timestamp = Math.floor(nowMs / 1000);
    const sign = createHmac("sha256", `${timestamp}\n${signingSecret}`).update("").digest("base64");
    payload.timestamp = String(timestamp);
    payload.sign = sign;
  }
  return { url: endpoint, body: JSON.stringify(payload) };
}

// DingTalk custom robot webhook. Body: {msgtype:"text",text:{content}}.
// 加签: sign = urlEncode(base64(HMAC_SHA256(key = secret, msg = `${ts}\n${secret}`))),
// ts in ms, appended to the URL as &timestamp=&sign=.
function buildDingtalkWebhook(
  endpoint: string,
  content: string,
  signingSecret: string | undefined,
  nowMs: number,
): RemoteWebhookRequest {
  const payload = { msgtype: "text", text: { content } };
  if (!signingSecret) {
    return { url: endpoint, body: JSON.stringify(payload) };
  }
  const timestamp = nowMs;
  const raw = createHmac("sha256", signingSecret)
    .update(`${timestamp}\n${signingSecret}`)
    .digest("base64");
  const sign = encodeURIComponent(raw);
  const sep = endpoint.includes("?") ? "&" : "?";
  return {
    url: `${endpoint}${sep}timestamp=${timestamp}&sign=${sign}`,
    body: JSON.stringify(payload),
  };
}

// WeCom group robot webhook. Body: {msgtype:"text",text:{content}}.
// Security is purely the URL `key` — no HMAC sign step exists for this path.
function buildWecomWebhook(endpoint: string, content: string): RemoteWebhookRequest {
  return { url: endpoint, body: JSON.stringify({ msgtype: "text", text: { content } }) };
}

export function buildWebhookRequest(
  channel: RemoteChannelState,
  event: RemoteEvent,
  signingSecret?: string,
  nowMs: number = Date.now(),
): RemoteWebhookBuild {
  const endpoint = channel.config.endpoint;
  if (!endpoint) {
    return { ok: false, reason: "missing_endpoint" };
  }
  const content = event.redactedSummary;
  const type = channel.config.type;
  if (channel.config.signingSecretRef && !signingSecret) {
    return { ok: false, reason: "missing_signing_secret" };
  }
  if (type === "feishu" || type === "lark") {
    return { ok: true, request: buildFeishuWebhook(endpoint, content, signingSecret, nowMs) };
  }
  if (type === "dingtalk") {
    return { ok: true, request: buildDingtalkWebhook(endpoint, content, signingSecret, nowMs) };
  }
  return { ok: true, request: buildWecomWebhook(endpoint, content) };
}

// Official CLI invocation as a safe argument ARRAY (never shell concatenation).
// Subcommands are grounded in each CLI's documented capabilities (lark-cli im
// messages-send; dws im send-by-bot; wecom-cli msg send_message) and are
// best-effort on exact flags — the redacted summary is always a discrete arg so
// untrusted content can never be interpreted as shell.
export function buildOfficialCliInvocation(
  channel: RemoteChannelState,
  event: RemoteEvent,
): RemoteCliBuild {
  const cliPath = channel.config.cliPath;
  if (!cliPath) {
    return { ok: false, reason: "missing_cli_path" };
  }
  const target = channel.config.bindingUserId;
  if (!target) {
    return { ok: false, reason: "missing_binding" };
  }
  const content = event.redactedSummary;
  const type = channel.config.type;
  if (type === "feishu" || type === "lark") {
    return {
      ok: true,
      command: cliPath,
      args: [
        "im",
        "messages-send",
        "--as",
        "bot",
        "--receive-id",
        target,
        "--msg-type",
        "text",
        "--text",
        content,
      ],
    };
  }
  if (type === "dingtalk") {
    return {
      ok: true,
      command: cliPath,
      args: ["im", "send-by-bot", "--user", target, "--msgtype", "text", "--text", content],
    };
  }
  return {
    ok: true,
    command: cliPath,
    args: ["msg", "send_message", "--to", target, "--msgtype", "text", "--text", content],
  };
}

// ---------------------------------------------------------------------------
// Delivery (injectable I/O)
// ---------------------------------------------------------------------------

function parsePlatformErrCode(body: string): number | undefined {
  try {
    const parsed = JSON.parse(body) as { errcode?: unknown; code?: unknown; StatusCode?: unknown };
    for (const value of [parsed.errcode, parsed.code, parsed.StatusCode]) {
      if (typeof value === "number") {
        return value;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function deliverWebhook(
  request: RemoteWebhookRequest,
  fetchImpl: RemoteFetch,
  signal?: AbortSignal,
): Promise<RemoteDeliveryResult> {
  try {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: request.body,
      signal,
    });
    const bodyText = await response.text();
    if (response.status === 401 || response.status === 403) {
      return { status: "failed", detail: `auth rejected (HTTP ${response.status})` };
    }
    if (response.status < 200 || response.status >= 300) {
      return { status: "failed", detail: `platform rejected (HTTP ${response.status})` };
    }
    const errcode = parsePlatformErrCode(bodyText);
    if (errcode !== undefined && errcode !== 0) {
      return { status: "failed", detail: `platform rejected (errcode ${errcode})` };
    }
    return { status: "sent", detail: "delivered redacted summary to remote channel" };
  } catch {
    // Detail is intentionally generic — never echo the endpoint or error payload,
    // which may contain the secret-bearing URL.
    return {
      status: "failed",
      detail: signal?.aborted
        ? "remote delivery cancelled"
        : "network error reaching remote channel",
    };
  }
}

function isCliMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT";
}

export async function deliverOfficialCli(
  command: string,
  args: string[],
  runner: RemoteCliRunner,
  timeoutMs: number = DEFAULT_CLI_TIMEOUT_MS,
): Promise<RemoteDeliveryResult> {
  try {
    await runner(command, args, timeoutMs);
    return { status: "sent", detail: "official CLI accepted the redacted send" };
  } catch (error) {
    if (isCliMissing(error)) {
      return { status: "blocked", detail: "official CLI not found; install and authenticate it" };
    }
    return { status: "failed", detail: "official CLI rejected the send" };
  }
}

// ---------------------------------------------------------------------------
// Default real dependencies
// ---------------------------------------------------------------------------

const defaultFetch: RemoteFetch = async (url, init) => {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abortFromCaller();
  else init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), DEFAULT_WEBHOOK_TIMEOUT_MS);
  const cleanup = () => {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abortFromCaller);
  };
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return {
      status: response.status,
      text: async () => {
        try {
          return await response.text();
        } finally {
          cleanup();
        }
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
};

const defaultRunCli: RemoteCliRunner = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    nodeExecFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

export function defaultRemoteTransportDeps(): RemoteTransportDeps {
  return {
    fetch: defaultFetch,
    runCli: defaultRunCli,
    resolveSecret: (ref) => process.env[ref],
    nowMs: () => Date.now(),
  };
}
