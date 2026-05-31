import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import type { RemoteChannelType } from "@linghun/config";
import {
  type RemoteInboxItem,
  type RemotePairingState,
  type RemoteChannelState,
  type RemoteInboundKind,
  type RemoteInboundMessage,
  type RemoteState,
} from "./tui-data-types.js";

export type RemoteBridgeReadiness =
  | "notification-only"
  | "fixture-ready"
  | "needs-app-setup"
  | "needs-dingtalk-app"
  | "needs-wecom-app"
  | "needs-daemon"
  | "ready";

export type RemoteBridgeCapability =
  | "notification-only"
  | "approval-capable"
  | "stream-callback-capable"
  | "natural-language-inbound-capable"
  | "app-callback-capable"
  | "full-mobile-control-capable";

export type RemoteBridgeDoctorReport = {
  channel: string;
  platform: RemoteChannelType;
  readiness: RemoteBridgeReadiness;
  capabilities: RemoteBridgeCapability[];
  now: string;
  canRunLocalFixture: boolean;
  inboundPath: string;
  nextAction: string;
  missing: string[];
};

export type RemotePairingDecision =
  | { status: "created"; summary: string; pairing: RemotePairingState; qr: string; fallback: string }
  | { status: "bound"; summary: string; pairing: RemotePairingState }
  | { status: "cancelled"; summary: string }
  | { status: "expired" | "unknown" | "channel_mismatch" | "replayed"; summary: string };

export type RemotePairingCodeValidation =
  | { status: "valid"; pairing: RemotePairingState }
  | { status: "expired" | "unknown" | "channel_mismatch" | "replayed"; summary: string };

export type RemoteTurnState = {
  activeModelTurn?: boolean;
  activeJob?: boolean;
  toolRunning?: boolean;
  pendingApproval?: boolean;
  sessionId?: string;
};

export type RemoteInboxDecision =
  | { status: "route"; reason: "idle"; message: RemoteInboundMessage }
  | { status: "queued"; reason: string; item: RemoteInboxItem }
  | { status: "status_only"; summary: string }
  | { status: "approval_only"; message: RemoteInboundMessage };

export type RemoteInboundFixtureInput = {
  kind: RemoteInboundKind;
  text?: string;
  approve?: boolean;
  eventId?: string;
  nowMs?: number;
  messageId?: string;
  nonce?: string;
};

export type RemoteAdapterInboundEvent = {
  platform: RemoteChannelType;
  source: string;
  userId: string;
  deviceId?: string;
  kind: RemoteInboundKind;
  text?: string;
  approve?: boolean;
  eventId?: string;
  messageId: string;
  nonce: string;
  signature?: string;
  expiresAt: string;
  receivedAt: string;
};

export function getRemoteBridgeDoctor(
  remote: RemoteState,
  channelId: string,
  now = new Date(),
): RemoteBridgeDoctorReport {
  const channel = remote.channels.find((item) => item.id === normalizeBridgeChannelId(channelId));
  if (!channel) {
    return {
      channel: channelId,
      platform: "feishu",
      readiness: "needs-app-setup",
      capabilities: ["notification-only"],
      now: now.toISOString(),
      canRunLocalFixture: false,
      inboundPath: "unknown channel",
      nextAction: "Run /remote bridge doctor feishu|dingtalk|wecom.",
      missing: ["known channel"],
    };
  }
  return describeBridgeChannel(channel, now);
}

export function formatRemoteBridgeDoctor(report: RemoteBridgeDoctorReport): string {
  return [
    `Remote bridge doctor：${report.channel}`,
    `- now: ${report.now}`,
    `- readiness: ${report.readiness}`,
    `- capabilities: ${report.capabilities.join(", ")}`,
    `- inbound path: ${report.inboundPath}`,
    `- local fixture: ${report.canRunLocalFixture ? "available" : "not available"}`,
    `- missing: ${report.missing.length ? report.missing.join(", ") : "none"}`,
    `- next: ${report.nextAction}`,
    "- webhook path remains notification-only; fixture PASS is not real mobile inbound.",
  ].join("\n");
}

export function createSignedRemoteInboundFixture(
  channel: RemoteChannelState,
  input: RemoteInboundFixtureInput,
): RemoteInboundMessage {
  const nowMs = input.nowMs ?? Date.now();
  const messageId = input.messageId ?? `fixture-${channel.id}-${input.kind}`;
  const nonce = input.nonce ?? stableFixtureNonce(channel.id, input.kind, messageId);
  return {
    kind: input.kind,
    channel: channel.id,
    messageId,
    nonce,
    source: channel.config.trustedSources[0] ?? `${channel.id}-fixture-source`,
    bindingUserId: channel.config.bindingUserId ?? `${channel.id}-fixture-user`,
    bindingDeviceId: channel.config.bindingDeviceId,
    signature: `mock:inbound:${messageId}:${nonce}`,
    expiresAt: new Date(nowMs + 60_000).toISOString(),
    receivedAt: new Date(nowMs).toISOString(),
    origin: "fixture",
    eventId: input.eventId,
    approve: input.approve,
    text: input.text,
  };
}

export function createRemotePairing(
  remote: RemoteState,
  channel: RemoteChannelState,
  projectPath: string,
  sessionId: string,
  nowMs = Date.now(),
  code = createPairingCode(),
): RemotePairingDecision {
  const pairing: RemotePairingState = {
    code,
    channel: channel.id,
    source: `${channel.id}-pairing`,
    projectPath,
    sessionId,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + 5 * 60 * 1000).toISOString(),
    consumedMessageIds: [],
    status: "pending",
  };
  remote.pairings = [pairing, ...remote.pairings.filter((item) => item.status === "pending")].slice(0, 5);
  return {
    status: "created",
    summary: `remote pairing code created for ${channel.id}`,
    pairing,
    qr: `linghun://remote-bind?channel=${encodeURIComponent(channel.id)}&code=${code}`,
    fallback: `/bind ${code}`,
  };
}

export function formatRemotePairing(pairing: RemotePairingDecision): string {
  if (pairing.status !== "created") {
    return pairing.summary;
  }
  return [
    `Remote pairing：${pairing.pairing.channel}`,
    `- code: ${pairing.pairing.code}`,
    `- expiresAt: ${pairing.pairing.expiresAt}`,
    `- phone fallback: ${pairing.fallback}`,
    `- QR payload: ${pairing.qr}`,
    "- QR render: not available in this terminal; please copy the fallback command.",
    "- webhook URL / secret / endpoint are not included.",
  ].join("\n");
}

export function formatRemotePairingStatus(remote: RemoteState): string {
  const active = remote.pairings.filter((item) => item.status === "pending");
  if (active.length === 0) return "Remote pairing：no active pairing code.";
  return [
    "Remote pairing status",
    ...active.map(
      (item) => `- ${item.channel}: ${item.code}; expiresAt=${item.expiresAt}; source=${item.source}`,
    ),
  ].join("\n");
}

export function cancelRemotePairing(remote: RemoteState, channelId?: string): RemotePairingDecision {
  const normalized = channelId ? normalizeBridgeChannelId(channelId) : undefined;
  const target = remote.pairings.find(
    (item) => item.status === "pending" && (!normalized || item.channel === normalized),
  );
  if (!target) return { status: "unknown", summary: "no active pairing code to cancel" };
  target.status = "cancelled";
  return { status: "cancelled", summary: `remote pairing cancelled for ${target.channel}` };
}

export function processRemoteBindCommand(
  remote: RemoteState,
  channel: RemoteChannelState,
  message: RemoteInboundMessage,
  nowMs = Date.now(),
): RemotePairingDecision | undefined {
  if (!parseBindCode(message.text ?? "")) return undefined;
  const validation = validateRemotePairingCode(remote, channel, message, nowMs);
  if (validation.status !== "valid") return validation;
  const pairing = validation.pairing;
  pairing.consumedMessageIds.unshift(message.messageId);
  pairing.status = "bound";
  channel.config.bindingUserId = message.bindingUserId;
  if (message.bindingDeviceId) channel.config.bindingDeviceId = message.bindingDeviceId;
  if (!channel.config.trustedSources.includes(message.source)) {
    channel.config.trustedSources.push(message.source);
  }
  channel.bindingStatus = "bound";
  channel.lastError = undefined;
  channel.nextAction = `/remote bridge test-inbound ${channel.id}`;
  return {
    status: "bound",
    summary: "remote pairing bound; mobile control remains summary-only and permission-aware",
    pairing,
  };
}

export function validateRemotePairingCode(
  remote: RemoteState,
  channel: RemoteChannelState,
  message: RemoteInboundMessage,
  nowMs = Date.now(),
): RemotePairingCodeValidation {
  const code = parseBindCode(message.text ?? "");
  const pairing = code
    ? remote.pairings.find((item) => item.code === code && item.status !== "cancelled")
    : undefined;
  if (!pairing) return { status: "unknown", summary: "pairing code is unknown" };
  if (pairing.status !== "pending") {
    return { status: "replayed", summary: "pairing code was already used" };
  }
  if (pairing.channel !== channel.id) {
    return { status: "channel_mismatch", summary: "pairing code belongs to another channel" };
  }
  if (Date.parse(pairing.expiresAt) <= nowMs) {
    pairing.status = "expired";
    return { status: "expired", summary: "pairing code expired" };
  }
  if (pairing.consumedMessageIds.includes(message.messageId)) {
    return { status: "replayed", summary: "pairing bind message replayed" };
  }
  return { status: "valid", pairing };
}

export function decideRemoteInbox(
  remote: RemoteState,
  message: RemoteInboundMessage,
  turn: RemoteTurnState,
  nowMs = Date.now(),
): RemoteInboxDecision {
  if (message.kind === "status_query") {
    return { status: "status_only", summary: formatRemoteStatusSummary(remote, turn) };
  }
  if (message.kind === "approval_response") {
    return { status: "approval_only", message };
  }
  const text = (message.text ?? "").trim();
  const busy = Boolean(turn.activeModelTurn || turn.activeJob || turn.toolRunning || turn.pendingApproval);
  if (!busy) {
    return { status: "route", reason: "idle", message };
  }
  const priority = hasInterruptIntent(text) ? "interrupt" : "normal";
  const item: RemoteInboxItem = {
    id: `rinbox-${stableFixtureNonce(message.channel, message.kind, message.messageId)}`,
    channel: message.channel,
    messageId: message.messageId,
    source: message.source,
    bindingUserId: message.bindingUserId,
    text,
    priority,
    reason: priority === "interrupt" ? "explicit interrupt intent" : "active local turn",
    createdAt: new Date(nowMs).toISOString(),
    sessionId: turn.sessionId,
  };
  remote.inbox.unshift(item);
  remote.inbox = remote.inbox.slice(0, 20);
  return { status: "queued", reason: item.reason, item };
}

export function formatRemoteInbox(remote: RemoteState): string {
  if (remote.inbox.length === 0) return "Remote inbox：empty.";
  return [
    "Remote inbox（summary-only）",
    ...remote.inbox.slice(0, 20).map(
      (item) =>
        `- ${item.id}: ${item.channel}; priority=${item.priority}; source=${item.source}; text=${redactMobileText(item.text)}`,
    ),
  ].join("\n");
}

export function clearRemoteInbox(remote: RemoteState): number {
  const count = remote.inbox.length;
  remote.inbox = [];
  return count;
}

export function rejectRemoteInboxItem(remote: RemoteState, id: string): boolean {
  const before = remote.inbox.length;
  remote.inbox = remote.inbox.filter((item) => item.id !== id);
  return remote.inbox.length !== before;
}

export function drainRemoteInbox(remote: RemoteState): RemoteInboxItem[] {
  const drained = [...remote.inbox].reverse();
  remote.inbox = [];
  return drained;
}

export function formatRemoteStatusSummary(remote: RemoteState, turn: RemoteTurnState): string {
  const busy = Boolean(turn.activeModelTurn || turn.activeJob || turn.toolRunning);
  return [
    `Linghun / remote / ${busy ? "busy" : "idle"}`,
    `status_query · pendingApproval=${turn.pendingApproval ? "yes" : "no"} · inbox=${remote.inbox.length}`,
    `Next: ${busy ? "wait or send explicit interrupt" : "send a short instruction"}`,
  ].join("\n");
}

export function feishuBridgeAdapter(event: RemoteAdapterInboundEvent): RemoteInboundMessage {
  return adaptBridgeEvent(event, "feishu");
}

export function dingtalkBridgeAdapter(event: RemoteAdapterInboundEvent): RemoteInboundMessage {
  return adaptBridgeEvent(event, "dingtalk");
}

export function wecomBridgeAdapter(event: RemoteAdapterInboundEvent): RemoteInboundMessage {
  return adaptBridgeEvent(event, "wecom");
}

function adaptBridgeEvent(
  event: RemoteAdapterInboundEvent,
  expectedPlatform: RemoteChannelType,
): RemoteInboundMessage {
  if (event.platform !== expectedPlatform) {
    throw new Error(`remote bridge adapter expected ${expectedPlatform}`);
  }
  return {
    kind: event.kind,
    channel: normalizeBridgeChannelId(expectedPlatform),
    messageId: event.messageId,
    nonce: event.nonce,
    source: event.source,
    bindingUserId: event.userId,
    bindingDeviceId: event.deviceId,
    signature: event.signature,
    expiresAt: event.expiresAt,
    receivedAt: event.receivedAt,
    origin: "adapter",
    eventId: event.eventId,
    approve: event.approve,
    text: event.text,
  };
}

function describeBridgeChannel(
  channel: RemoteChannelState,
  now: Date,
): RemoteBridgeDoctorReport {
  const missing = bridgeMissingFields(channel);
  const webhookOnly =
    channel.config.transport === "webhook" || channel.config.transport === "webhook_mock";
  if (webhookOnly) {
    return baseReport(channel, now, {
      readiness: "notification-only",
      capabilities: ["notification-only"],
      canRunLocalFixture: false,
      inboundPath: "outbound webhook only",
      missing,
      nextAction:
        "Use webhook for short status notifications only; configure an official app/CLI bridge for inbound.",
    });
  }
  const capabilities = platformBridgeCapabilities(channel.config.type);
  const needsApp = missing.some((item) => item.includes("credentials")) || missing.includes("trusted source");
  const needsDaemon =
    channel.config.inboundMode === "poll"
      ? !channel.config.cliPath
      : channel.config.inboundMode === "callback" && !channel.config.callbackEndpoint;
  const readiness: RemoteBridgeReadiness = needsApp
    ? platformNeedsAppReadiness(channel.config.type)
    : needsDaemon
      ? "needs-daemon"
      : "fixture-ready";
  return baseReport(channel, now, {
    readiness,
    capabilities,
    canRunLocalFixture: !needsApp,
    inboundPath: bridgeInboundPath(channel),
    missing,
    nextAction: bridgeNextAction(channel, readiness),
  });
}

function baseReport(
  channel: RemoteChannelState,
  now: Date,
  partial: Omit<RemoteBridgeDoctorReport, "channel" | "platform" | "now">,
): RemoteBridgeDoctorReport {
  return {
    channel: channel.id,
    platform: channel.config.type,
    now: now.toISOString(),
    ...partial,
  };
}

function bridgeMissingFields(channel: RemoteChannelState): string[] {
  const missing: string[] = [];
  const config = channel.config;
  if (!config.bindingUserId) missing.push("binding user");
  if (config.trustedSources.length === 0) missing.push("trusted source");
  if (config.transport === "official_cli" && !config.cliPath) missing.push("cli path");
  if (config.transport === "official_cli" && (!config.inboundMode || config.inboundMode === "none")) {
    missing.push("inbound mode");
  }
  if (config.inboundMode === "callback" && !config.callbackEndpoint) missing.push("callback endpoint");
  if (config.type === "feishu" || config.type === "lark") {
    if (!config.appIdRef || !config.appSecretRef) missing.push("app credentials");
    if (config.inboundMode === "callback" && (!config.encryptKeyRef || !config.verificationTokenRef)) {
      missing.push("callback verification refs");
    }
  }
  if (config.type === "dingtalk" && !config.appIdRef && !config.tokenRef) {
    missing.push("dingtalk app credentials");
  }
  if ((config.type === "wecom" || config.type === "enterprise-wechat") && !config.appIdRef && !config.tokenRef) {
    missing.push("wecom app credentials");
  }
  return [...new Set(missing)];
}

function platformBridgeCapabilities(type: RemoteChannelType): RemoteBridgeCapability[] {
  if (type === "feishu" || type === "lark") {
    return ["full-mobile-control-capable", "app-callback-capable"];
  }
  if (type === "dingtalk") {
    return ["approval-capable", "stream-callback-capable"];
  }
  return ["natural-language-inbound-capable", "app-callback-capable"];
}

function bridgeInboundPath(channel: RemoteChannelState): string {
  if (channel.config.inboundMode === "callback") {
    return channel.config.callbackEndpoint ? "app callback endpoint configured" : "app callback endpoint needed";
  }
  if (channel.config.inboundMode === "poll") {
    return channel.config.localBridgePort
      ? `local bridge daemon on port ${channel.config.localBridgePort}`
      : "official CLI poll/stream daemon needed";
  }
  return "inbound disabled";
}

function bridgeNextAction(
  channel: RemoteChannelState,
  readiness: RemoteBridgeReadiness,
): string {
  if (readiness === "fixture-ready") {
    return `/remote bridge test-inbound ${channel.id}; real mobile inbound still needs platform credentials and callback/daemon.`;
  }
  if (readiness === "needs-daemon") {
    return "Start/configure the official CLI poll/stream daemon or provide a callback endpoint.";
  }
  if (readiness === "needs-app-setup") {
    return "Configure Feishu/Lark app refs and callback verification refs before full mobile control is ready.";
  }
  if (readiness === "needs-dingtalk-app") {
    return "Configure a DingTalk app/Stream callback before approval inbound is ready.";
  }
  if (readiness === "needs-wecom-app") {
    return "Configure a WeCom app callback before natural-language inbound is ready.";
  }
  return "Keep webhook as notification-only.";
}

function platformNeedsAppReadiness(type: RemoteChannelType): RemoteBridgeReadiness {
  if (type === "dingtalk") return "needs-dingtalk-app";
  if (type === "wecom" || type === "enterprise-wechat") return "needs-wecom-app";
  return "needs-app-setup";
}

function normalizeBridgeChannelId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "lark") return "feishu";
  if (normalized === "enterprise-wechat") return "wecom";
  return normalized;
}

function createPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function parseBindCode(text: string): string | undefined {
  const match = text.trim().match(/^\/bind\s+([A-Z0-9]{6})$/i);
  return match?.[1]?.toUpperCase();
}

function hasInterruptIntent(text: string): boolean {
  return /插队|立即处理|暂停当前任务|interrupt/i.test(text);
}

function redactMobileText(text: string): string {
  return text.replace(/(secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
}

function stableFixtureNonce(channelId: string, kind: RemoteInboundKind, messageId: string): string {
  return createHash("sha256").update(`${channelId}:${kind}:${messageId}`).digest("hex").slice(0, 16);
}
