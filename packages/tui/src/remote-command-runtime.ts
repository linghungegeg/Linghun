import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { RemoteChannelType, RemoteEventType } from "@linghun/config";
import type { TuiContext } from "./index.js";
import { redactRemoteSummary, remoteTranscriptSummary } from "./permission-continuation-runtime.js";
import { formatRemoteStatus, formatRemoteTestResult } from "./remote-mcp-presenter.js";
import { showCommandPanel } from "./command-panel-runtime.js";
import { applyRemoteSessionDisables, createRemoteState } from "./tui-state-runtime.js";
import { truncateDisplay, writeLine } from "./startup-runtime.js";
import type { RemoteApprovalDecision, RemoteApprovalMessage, RemoteChannelState, RemoteEvent } from "./tui-data-types.js";

export type RemoteCommandRuntimeDeps = {
  appendSystemEvent: (
    context: TuiContext,
    sessionId: string,
    message: string,
    level: "info" | "warning",
  ) => Promise<void>;
  ensureSession: (context: TuiContext) => Promise<string>;
};

let runtimeDeps: RemoteCommandRuntimeDeps | undefined;

export function configureRemoteCommandRuntime(deps: RemoteCommandRuntimeDeps): void {
  runtimeDeps = deps;
}

function deps(): RemoteCommandRuntimeDeps {
  if (!runtimeDeps) {
    throw new Error("remote-command-runtime deps not configured");
  }
  return runtimeDeps;
}

export function refreshRemoteState(context: TuiContext): void {
  const previous = context.remote;
  context.remote = createRemoteState(context.config);
  context.remote.events = previous.events;
  context.remote.processedMessageIds = previous.processedMessageIds;
  context.remote.sessionDisabledChannelIds = previous.sessionDisabledChannelIds;
  context.remote.lastDoctor = previous.lastDoctor;
  context.remote.lastApproval = previous.lastApproval;
  applyRemoteSessionDisables(context.remote);
}

export async function handleRemoteCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  refreshRemoteState(context);
  const action = args[0] ?? "status";
  if (action === "status") {
    // D.13Q-UX Task Surface — /remote status 默认走降噪 CommandPanel。
    const isEn = context.language === "en-US";
    const enabled = context.remote.enabled;
    const lastDoctor = context.remote.lastDoctor;
    const summary: string[] = [
      isEn
        ? `Remote ${enabled ? "enabled" : "disabled"}`
        : `远程 ${enabled ? "已启用" : "未启用"}`,
    ];
    if (!lastDoctor) {
      summary.push(
        isEn ? "Not yet diagnosed — run /remote doctor." : "尚未诊断 — 运行 /remote doctor。",
      );
    }
    showCommandPanel(context, output, {
      title: "/remote",
      tone: "neutral",
      summary,
      actions: ["/remote doctor"],
      detailsText: formatRemoteStatus(context.remote),
    });
    return;
  }
  if (action === "doctor") {
    const report = formatRemoteDoctor(context);
    context.remote.lastDoctor = report;
    await appendRemoteSystemEvent(
      context,
      `remote_doctor ${remoteTranscriptSummary(report)}`,
      "info",
    );
    writeLine(output, report);
    return;
  }
  if (action === "setup") {
    writeLine(output, formatRemoteSetup(args[1], context));
    return;
  }
  if (action === "test") {
    const channel = findRemoteChannel(context, args[1]);
    if (!channel) {
      writeLine(output, "Remote test：未识别通道。用法：/remote test feishu|wecom|dingtalk");
      return;
    }
    const event = createRemoteEvent(
      channel,
      "job_status",
      "Remote channel test: Linghun redacted summary only.",
      [],
      5 * 60 * 1000,
    );
    const result = sendRemoteEvent(context, event);
    await appendRemoteSystemEvent(
      context,
      `remote_test channel=${channel.id} status=${result.status} summary=${event.redactedSummary}`,
      result.status === "sent" ? "info" : "warning",
    );
    writeLine(output, formatRemoteTestResult(channel, result));
    return;
  }
  if (action === "disable") {
    const channel = findRemoteChannel(context, args[1]);
    if (!channel) {
      writeLine(output, "Remote disable：未识别通道。用法：/remote disable feishu|wecom|dingtalk");
      return;
    }
    if (!context.remote.sessionDisabledChannelIds.includes(channel.id)) {
      context.remote.sessionDisabledChannelIds.push(channel.id);
    }
    channel.runtimeStatus = "disabled";
    channel.lastError = "disabled_by_user";
    channel.nextAction = `/remote setup ${channel.id}`;
    await appendRemoteSystemEvent(context, `remote_disabled channel=${channel.id}`, "info");
    writeLine(
      output,
      `Remote channel disabled：${channel.id}\n- 本地 TUI 不受影响。\n- 如需重新连接：/remote setup ${channel.id}`,
    );
    return;
  }
  writeLine(
    output,
    "用法：/remote setup <channel> | /remote test <channel> | /remote status | /remote doctor | /remote disable <channel>",
  );
}

export function formatRemoteDoctor(context: TuiContext): string {
  const lines = [
    `Remote Doctor：${context.remote.enabled ? "enabled" : "disabled"}；失败会降级为 disabled/blocked，不阻塞主 TUI。`,
  ];
  for (const channel of context.remote.channels) {
    lines.push(`- ${channel.id}: ${channel.runtimeStatus}`);
    lines.push(`  binding: ${channel.bindingStatus}`);
    lines.push(`  transport: ${channel.config.transport}; status=${channel.transportStatus}`);
    lines.push(`  last error: ${channel.lastError ?? "none"}`);
    lines.push(`  allowed events: ${channel.config.allowedEventTypes.join(", ")}`);
    lines.push(`  next action: ${channel.nextAction}`);
  }
  lines.push("Secrets/endpoints are redacted. Use webhook_mock for notification-only dry runs.");
  return lines.join("\n");
}

export function formatRemoteSetup(channelArg: string | undefined, context: TuiContext): string {
  const channel = findRemoteChannel(context, channelArg);
  if (!channel) {
    return "Remote setup：请选择 feishu、wecom 或 dingtalk。示例：/remote setup feishu";
  }
  const loginHint = getRemoteLoginHint(channel.config.type);
  const fallback =
    "如果只想收通知，可配置 webhook_mock/webhook fallback；不要在主屏粘贴 secret/token/full endpoint。";
  return [
    `Remote setup：${channel.id}（默认不自动启用；先完成绑定和信任来源）`,
    `- 推荐路径：${loginHint}`,
    `- 当前 binding: ${channel.bindingStatus}; transport=${channel.config.transport}/${channel.transportStatus}`,
    `- 下一步：完成 CLI 登录或 webhook 填写后运行 /remote test ${channel.id}，再运行 /remote status。`,
    `- ${fallback}`,
  ].join("\n");
}

export function findRemoteChannel(
  context: TuiContext,
  channelArg: string | undefined,
): RemoteChannelState | undefined {
  const id = normalizeRemoteChannelId(channelArg ?? "");
  return context.remote.channels.find((channel) => channel.id === id || channel.config.type === id);
}

export function normalizeRemoteChannelId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "lark") return "feishu";
  if (normalized === "enterprise-wechat") return "wecom";
  return normalized;
}

export function getRemoteLoginHint(type: RemoteChannelType): string {
  if (type === "feishu" || type === "lark") {
    return "检测 lark-cli / feishu-cli；未初始化请运行 feishu-cli config init 或 lark-cli auth login。";
  }
  if (type === "dingtalk") {
    return "检测 dws；未登录请运行 dws auth login 或 dws device login。";
  }
  return "检测 wecom-cli；未初始化请运行 wecom-cli init，然后检查 auth/login 状态。";
}

export function getRemoteInstallHint(type: RemoteChannelType): string {
  if (type === "feishu" || type === "lark") {
    return "install lark-cli/feishu-cli, then run feishu-cli config init or lark-cli auth login";
  }
  if (type === "dingtalk") {
    return "install dws, then run dws auth login or dws device login";
  }
  return "install wecom-cli, then run wecom-cli init/auth";
}

export function createRemoteEvent(
  channel: RemoteChannelState,
  eventType: RemoteEventType,
  summary: string,
  refs: string[] = [],
  ttlMs = 10 * 60 * 1000,
): RemoteEvent {
  const now = Date.now();
  const id = `remote-${randomUUID().slice(0, 8)}`;
  return {
    id,
    channel: channel.id,
    eventType,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    nonce: randomUUID(),
    messageId: `msg-${randomUUID().slice(0, 12)}`,
    source: channel.config.trustedSources[0] ?? "local-test",
    redactedSummary: redactRemoteSummary(summary),
    refs: refs.map((ref) => truncateDisplay(redactRemoteSummary(ref), 120)),
    status: "pending",
  };
}

export function sendRemoteEvent(context: TuiContext, event: RemoteEvent): RemoteEvent {
  const channel = context.remote.channels.find((item) => item.id === event.channel);
  const next = { ...event };
  if (!channel || channel.runtimeStatus !== "ready") {
    next.status = "failed";
  } else if (!channel.config.allowedEventTypes.includes(event.eventType)) {
    next.status = "rejected";
  } else if (channel.config.transport === "webhook" && !channel.config.endpoint) {
    next.status = "failed";
  } else {
    next.status = "sent";
  }
  context.remote.events.unshift(next);
  context.remote.events = context.remote.events.slice(0, 20);
  return next;
}

export function processRemoteApprovalForTest(
  context: TuiContext,
  event: RemoteEvent,
  message: RemoteApprovalMessage,
): RemoteApprovalDecision {
  const decision = processRemoteApproval(context, event, message);
  context.remote.lastApproval = decision;
  return decision;
}

export function processRemoteApproval(
  context: TuiContext,
  event: RemoteEvent,
  message: RemoteApprovalMessage,
): RemoteApprovalDecision {
  const channel = context.remote.channels.find((item) => item.id === event.channel);
  const reject = (
    status: RemoteApprovalDecision["status"],
    summary: string,
  ): RemoteApprovalDecision => {
    event.status = status === "expired" ? "expired" : "rejected";
    return { status, summary, evidenceCreated: false };
  };
  if (!channel || channel.runtimeStatus !== "ready") {
    return reject("blocked", "remote channel is not ready");
  }
  if (event.eventType !== "approval_request") {
    return reject("blocked", "remote event is not an approval_request");
  }
  if (Date.parse(event.expiresAt) <= Date.now()) {
    return reject("expired", "remote approval expired");
  }
  if (context.remote.processedMessageIds.includes(message.messageId)) {
    return reject("replayed", "remote approval replayed");
  }
  if (message.messageId !== event.messageId || message.nonce !== event.nonce) {
    return reject("bad_signature", "remote approval nonce/messageId mismatch");
  }
  if (!channel.config.trustedSources.includes(message.source)) {
    return reject("unknown_source", "remote approval source is not trusted");
  }
  if (
    message.bindingUserId !== channel.config.bindingUserId ||
    (channel.config.bindingDeviceId && message.bindingDeviceId !== channel.config.bindingDeviceId)
  ) {
    return reject("wrong_binding", "remote approval binding mismatch");
  }
  if (!verifyRemoteSignature(channel, event, message)) {
    return reject("bad_signature", "remote approval signature check failed");
  }
  if (!context.pendingLocalApproval) {
    return reject("blocked", "no local pending approval to resume");
  }
  context.remote.processedMessageIds.unshift(message.messageId);
  context.remote.processedMessageIds = context.remote.processedMessageIds.slice(0, 50);
  event.status = message.approve ? "approved" : "rejected";
  return {
    status: message.approve ? "approved" : "rejected",
    summary: message.approve
      ? "remote approval validated; local permission pipeline remains the execution boundary"
      : "remote approval rejected by user",
    evidenceCreated: false,
  };
}

export function verifyRemoteSignature(
  channel: RemoteChannelState,
  event: RemoteEvent,
  message: RemoteApprovalMessage,
): boolean {
  if (!channel.config.signingSecretRef) {
    return message.signature === `mock:${event.messageId}:${event.nonce}`;
  }
  return typeof message.signature === "string" && message.signature.startsWith("ref:");
}

export async function appendRemoteSystemEvent(
  context: TuiContext,
  message: string,
  level: "info" | "warning",
): Promise<void> {
  await deps().appendSystemEvent(
    context,
    await deps().ensureSession(context),
    remoteTranscriptSummary(message),
    level,
  );
}
