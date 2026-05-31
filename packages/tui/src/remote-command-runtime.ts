import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { RemoteChannelType, RemoteEventType } from "@linghun/config";
import { showCommandPanel } from "./command-panel-runtime.js";
import type { TuiContext } from "./index.js";
import { redactRemoteSummary, remoteTranscriptSummary } from "./permission-continuation-runtime.js";
import { formatRemoteStatus, formatRemoteTestResult } from "./remote-mcp-presenter.js";
import {
  type RemoteTransportDeps,
  buildOfficialCliInvocation,
  buildWebhookRequest,
  defaultRemoteTransportDeps,
  deliverOfficialCli,
  deliverWebhook,
} from "./remote-transport.js";
import { truncateDisplay, writeLine } from "./startup-runtime.js";
import type {
  RemoteApprovalDecision,
  RemoteApprovalMessage,
  RemoteChannelState,
  RemoteEvent,
  RemoteEventStatus,
  RemoteInboundDecision,
  RemoteInboundMessage,
} from "./tui-data-types.js";
import { applyRemoteSessionDisables, createRemoteState } from "./tui-state-runtime.js";

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

// D.14E — 可注入的真实发送 transport deps；未配置时回退到真实网络/进程实现。
// 测试通过 sendRemoteEventReal 的 depsOverride 注入 stub，永不触网/触进程。
let remoteTransportDeps: RemoteTransportDeps | undefined;

export function configureRemoteCommandRuntime(deps: RemoteCommandRuntimeDeps): void {
  runtimeDeps = deps;
}

export function configureRemoteTransport(deps: RemoteTransportDeps): void {
  remoteTransportDeps = deps;
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
      isEn ? `Remote ${enabled ? "enabled" : "disabled"}` : `远程 ${enabled ? "已启用" : "未启用"}`,
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
    // D.14D-E — /remote doctor 走降噪 CommandPanel：完整诊断进 detailsText。
    showCommandPanel(context, output, {
      title: "/remote doctor",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? "Remote doctor — Ctrl+O for details."
          : "远程诊断 — Ctrl+O 查看详情。",
      ],
      detailsText: report,
    });
    return;
  }
  if (action === "setup") {
    // D.14D-E — /remote setup 引导信息走降噪 CommandPanel：完整步骤进 detailsText。
    showCommandPanel(context, output, {
      title: "/remote setup",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? "Remote setup guidance — Ctrl+O for details."
          : "远程接入引导 — Ctrl+O 查看详情。",
      ],
      detailsText: formatRemoteSetup(args[1], context),
    });
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
    const result = await sendRemoteEventReal(context, event);
    const ok = result.status === "sent";
    await appendRemoteSystemEvent(
      context,
      `remote_test channel=${channel.id} status=${result.status} detail=${result.deliveryDetail ?? "none"} summary=${event.redactedSummary}`,
      ok ? "info" : "warning",
    );
    // D.14D-E — /remote test 结果走降噪 CommandPanel：完整结果进 detailsText。
    showCommandPanel(context, output, {
      title: "/remote test",
      tone: ok ? "neutral" : result.status === "mock" ? "neutral" : "warning",
      summary: [
        context.language === "en-US"
          ? `Remote test ${channel.id} · ${result.status} — Ctrl+O for details.`
          : `远程测试 ${channel.id} · ${result.status} — Ctrl+O 查看详情。`,
      ],
      detailsText: formatRemoteTestResult(channel, result),
    });
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
    // D.14D-E — /remote disable 结果走降噪 CommandPanel：完整结果进 detailsText。
    showCommandPanel(context, output, {
      title: "/remote disable",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? `Remote channel disabled: ${channel.id} — Ctrl+O for details.`
          : `已禁用远程通道：${channel.id} — Ctrl+O 查看详情。`,
      ],
      detailsText: `Remote channel disabled：${channel.id}\n- 本地 TUI 不受影响。\n- 如需重新连接：/remote setup ${channel.id}`,
    });
    return;
  }
  if (action === "events" || action === "inbox") {
    showCommandPanel(context, output, {
      title: "/remote events",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? `Recent remote events: ${context.remote.events.length} — Ctrl+O for details.`
          : `最近远程事件：${context.remote.events.length} 条 — Ctrl+O 查看详情。`,
      ],
      detailsText: formatRemoteEvents(context),
    });
    return;
  }
  writeLine(
    output,
    "用法：/remote setup <channel> | /remote test <channel> | /remote status | /remote doctor | /remote events | /remote disable <channel>",
  );
}

export function formatRemoteEvents(context: TuiContext): string {
  if (context.remote.events.length === 0) {
    return "Remote events：暂无远程事件。运行 /remote test <channel> 发送一条脱敏测试摘要。";
  }
  const lines = ["Remote events（最近在前，仅脱敏摘要，不含 secret/endpoint/正文）"];
  for (const event of context.remote.events.slice(0, 10)) {
    lines.push(
      `- ${event.channel} · ${event.eventType} · ${event.status}${event.deliveryDetail ? ` · ${event.deliveryDetail}` : ""}`,
    );
    lines.push(`  summary: ${event.redactedSummary}`);
  }
  return lines.join("\n");
}

export function formatRemoteDoctor(context: TuiContext): string {
  const lines = [
    `Remote Doctor：${context.remote.enabled ? "enabled" : "disabled"}；失败会降级为 disabled/blocked，不阻塞主 TUI。`,
  ];
  for (const channel of context.remote.channels) {
    const grade = getRemoteCapabilityGrade(channel);
    lines.push(`- ${channel.id}: ${channel.runtimeStatus}`);
    lines.push(`  binding: ${channel.bindingStatus}`);
    lines.push(`  transport: ${channel.config.transport}; status=${channel.transportStatus}`);
    lines.push(`  capability: ${grade.grade} — ${grade.reason}`);
    lines.push(`  last error: ${channel.lastError ?? "none"}`);
    lines.push(`  allowed events: ${channel.config.allowedEventTypes.join(", ")}`);
    lines.push(`  next action: ${channel.nextAction}`);
  }
  lines.push(
    "Secrets/endpoints are redacted. webhook/webhook_mock 仅单向通知；审批/自然语言回传需官方 CLI/应用入站能力。",
  );
  return lines.join("\n");
}

export type RemoteCapabilityGrade =
  | "notification-only"
  | "approval-capable"
  | "natural-language-inbound-capable"
  | "full-mobile-control-capable";

// D.14E — 按平台真实能力分级（基于官方文档事实，不臆测）。webhook/webhook_mock
// 恒为单向通知；只有官方 CLI 通道开启入站（inboundMode poll/callback）时，才按平台
// 上限分级：feishu/lark 官方 CLI=full（事件订阅+审批域）；wecom=NL 入站（轮询历史）；
// dingtalk=审批能力（oa）。inboundMode=none 的官方 CLI 仍只用于出站通知。
export function getRemoteCapabilityGrade(channel: RemoteChannelState): {
  grade: RemoteCapabilityGrade;
  reason: string;
} {
  const { transport, type, inboundMode } = channel.config;
  if (transport === "webhook" || transport === "webhook_mock") {
    return {
      grade: "notification-only",
      reason: "webhook 单向投递摘要；不能接收审批或消息回传",
    };
  }
  if (!inboundMode || inboundMode === "none") {
    return {
      grade: "notification-only",
      reason: "官方 CLI 仅用于出站通知；inboundMode=none 未开启入站",
    };
  }
  if (type === "feishu" || type === "lark") {
    return {
      grade: "full-mobile-control-capable",
      reason: "官方 CLI 事件订阅+审批域，支持审批与自然语言回传",
    };
  }
  if (type === "wecom" || type === "enterprise-wechat") {
    return {
      grade: "natural-language-inbound-capable",
      reason: "官方 CLI 可轮询消息历史接收自然语言；交互审批需自建应用回调",
    };
  }
  return {
    grade: "approval-capable",
    reason: "官方 CLI 审批操作可用；实时消息回传需 Stream/回调应用",
  };
}

export function formatRemoteSetup(channelArg: string | undefined, context: TuiContext): string {
  const channel = findRemoteChannel(context, channelArg);
  if (!channel) {
    return "Remote setup：请选择 feishu、wecom 或 dingtalk。示例：/remote setup feishu";
  }
  const config = channel.config;
  const isWebhook = config.transport === "webhook" || config.transport === "webhook_mock";
  const grade = getRemoteCapabilityGrade(channel);
  const field = (label: string, ok: boolean, hint: string): string =>
    `- ${ok ? "[已填]" : "[待填]"} ${label}${ok ? "" : ` — ${hint}`}`;
  const lines = [
    `Remote setup：${channel.id}（默认不自动启用；只需填必要字段，无需理解底层机制）`,
    `- 通道能力：${grade.grade} — ${grade.reason}`,
  ];
  // 必要字段清单（人话；不打印 secret/full endpoint，只判断是否已填）。
  if (isWebhook) {
    lines.push(
      field(
        "webhook endpoint",
        Boolean(config.endpoint),
        `配置脱敏 webhook 地址（${getRemoteLoginHint(config.type)}）`,
      ),
    );
    lines.push(
      field(
        "signing secret 引用",
        Boolean(config.signingSecretRef),
        config.type === "wecom" || config.type === "enterprise-wechat"
          ? "企业微信群机器人无独立签名，安全性来自 URL key（可留空）"
          : "填环境变量名（如 LINGHUN_REMOTE_FEISHU_SECRET），不要粘贴明文",
      ),
    );
  } else {
    lines.push(
      field(
        "official CLI 登录",
        channel.transportStatus === "ready",
        getRemoteLoginHint(config.type),
      ),
    );
    lines.push(
      field(
        "入站模式 inboundMode",
        Boolean(config.inboundMode && config.inboundMode !== "none"),
        "poll=CLI 拉取消息 / callback=已部署回调端点；none 仅出站通知",
      ),
    );
  }
  lines.push(field("绑定用户 bindingUserId", Boolean(config.bindingUserId), "填手机端可信用户 id"));
  lines.push(
    field(
      "绑定设备 bindingDeviceId",
      Boolean(config.bindingDeviceId),
      "可选；填了则审批/入站会校验设备",
    ),
  );
  lines.push(
    field(
      "可信来源 trustedSources",
      config.trustedSources.length > 0,
      "至少添加一个可信来源 id，否则通道保持 blocked",
    ),
  );
  if (!isWebhook) {
    lines.push(
      field(
        "回调端点 callbackEndpoint",
        Boolean(config.callbackEndpoint),
        "仅 inboundMode=callback 需要；poll 模式可留空",
      ),
    );
  }
  lines.push(
    `- 当前状态：runtime=${channel.runtimeStatus}; binding=${channel.bindingStatus}; transport=${config.transport}/${channel.transportStatus}`,
    `- 下一步：补齐 [待填] 字段后运行 /remote test ${channel.id}，再运行 /remote status；不要在主屏粘贴 secret/token/full endpoint。`,
  );
  return lines.join("\n");
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

// D.14E — 真实发送链路。webhook 走 HTTP POST 脱敏 payload；official_cli 走安全参数
// 数组（execFile，不 shell 拼接）；webhook_mock 恒为 diagnostic mock，不代表真实
// delivery PASS。失败明确区分 missing config / cli missing / network / auth /
// platform reject / mock-only。secret/endpoint 不进 deliveryDetail/transcript。
export async function sendRemoteEventReal(
  context: TuiContext,
  event: RemoteEvent,
  depsOverride?: RemoteTransportDeps,
): Promise<RemoteEvent> {
  const transport = depsOverride ?? remoteTransportDeps ?? defaultRemoteTransportDeps();
  const channel = context.remote.channels.find((item) => item.id === event.channel);
  const next = { ...event };
  const finalize = (status: RemoteEventStatus, detail: string): RemoteEvent => {
    next.status = status;
    next.deliveryDetail = detail;
    context.remote.events.unshift(next);
    context.remote.events = context.remote.events.slice(0, 20);
    return next;
  };
  if (!channel || channel.runtimeStatus !== "ready") {
    return finalize("failed", "remote channel is not ready");
  }
  if (!channel.config.allowedEventTypes.includes(event.eventType)) {
    return finalize("rejected", `event type ${event.eventType} is not allowed on this channel`);
  }
  if (channel.config.transport === "webhook_mock") {
    return finalize("mock", "webhook_mock diagnostic dry run — not a real remote delivery");
  }
  if (channel.config.transport === "webhook") {
    const secret = channel.config.signingSecretRef
      ? transport.resolveSecret(channel.config.signingSecretRef)
      : undefined;
    if (channel.config.signingSecretRef && !secret) {
      return finalize("failed", "signing secret reference could not be resolved");
    }
    const build = buildWebhookRequest(channel, event, secret, transport.nowMs());
    if (!build.ok) {
      return finalize("failed", "missing redacted webhook endpoint configuration");
    }
    const result = await deliverWebhook(build.request, transport.fetch);
    return finalize(result.status === "sent" ? "sent" : "failed", result.detail);
  }
  const invocation = buildOfficialCliInvocation(channel, event);
  if (!invocation.ok) {
    return finalize(
      "failed",
      invocation.reason === "missing_binding"
        ? "official CLI needs a bound user before sending"
        : "official CLI path is not configured",
    );
  }
  const result = await deliverOfficialCli(invocation.command, invocation.args, transport.runCli);
  const status: RemoteEventStatus =
    result.status === "sent" ? "sent" : result.status === "blocked" ? "blocked" : "failed";
  return finalize(status, result.detail);
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

// D.14E — 入站消息的签名/等价证明校验。手机回传由手机端自带 messageId/nonce，
// 无对应出站 event，因此独立校验：未配 signingSecretRef 时只接受 mock 入站证明
// （diagnostic/test-only）；配了 secret ref 时要求 ref: 形式的真实代理证明。
export function verifyRemoteInboundSignature(
  channel: RemoteChannelState,
  message: RemoteInboundMessage,
): boolean {
  if (!channel.config.signingSecretRef) {
    return message.signature === `mock:inbound:${message.messageId}:${message.nonce}`;
  }
  return typeof message.signature === "string" && message.signature.startsWith("ref:");
}

// D.14E — 远程入站统一入口。三类入站（approval_response / natural_language_message /
// status_query）必须先全部通过本地校验，再交回本地主链/权限管道。本函数不执行任何
// 工具/Bash/写文件/Git，不清空 pendingLocalApproval；natural_language_message 通过后
// 只返回 routedText，由 index.ts glue 投回本地模型主链（无本地关键词截获、无第二套执行器）。
export function processRemoteInbound(
  context: TuiContext,
  message: RemoteInboundMessage,
): RemoteInboundDecision {
  const channel = context.remote.channels.find((item) => item.id === message.channel);
  const reject = (
    status: RemoteInboundDecision["status"],
    summary: string,
  ): RemoteInboundDecision => ({ kind: message.kind, status, summary, evidenceCreated: false });
  if (!channel || channel.runtimeStatus !== "ready") {
    return reject("channel_not_ready", "remote channel is not ready");
  }
  // 入站能力分级：webhook / webhook_mock 恒为 notification-only；只有官方 CLI poll
  // 或已部署 callback 端点（inboundMode poll/callback）才允许手机回传。
  if (
    channel.config.transport !== "official_cli" ||
    !channel.config.inboundMode ||
    channel.config.inboundMode === "none"
  ) {
    return reject("inbound_disabled", "remote channel is notification-only; inbound is disabled");
  }
  if (Date.parse(message.expiresAt) <= Date.now()) {
    return reject("expired", "remote inbound message expired");
  }
  if (context.remote.processedMessageIds.includes(message.messageId)) {
    return reject("replayed", "remote inbound message replayed");
  }
  if (!channel.config.trustedSources.includes(message.source)) {
    return reject("unknown_source", "remote inbound source is not trusted");
  }
  if (
    message.bindingUserId !== channel.config.bindingUserId ||
    (channel.config.bindingDeviceId && message.bindingDeviceId !== channel.config.bindingDeviceId)
  ) {
    return reject("wrong_binding", "remote inbound binding mismatch");
  }
  if (!verifyRemoteInboundSignature(channel, message)) {
    return reject("bad_signature", "remote inbound signature check failed");
  }
  const consume = (): void => {
    context.remote.processedMessageIds.unshift(message.messageId);
    context.remote.processedMessageIds = context.remote.processedMessageIds.slice(0, 50);
  };
  if (message.kind === "approval_response") {
    // plan 模式恒只读：远程 approve 不能执行任何写操作。pending approval 在 plan
    // 模式下只会是 mutating 操作，因此直接在边界拒绝，不消费 nonce。
    if (context.permissionMode === "plan") {
      return reject(
        "blocked",
        "plan mode keeps writes read-only; remote approval cannot execute mutating operations",
      );
    }
    if (!context.pendingLocalApproval) {
      return reject("no_pending_approval", "no local pending approval to resume");
    }
    const event = message.eventId
      ? context.remote.events.find((item) => item.id === message.eventId)
      : undefined;
    if (!event || event.eventType !== "approval_request") {
      return reject("blocked", "approval_response does not match a known approval_request");
    }
    // D.14E 小返修 — 必须校验被引用的 approval_request 自身是否过期，而不只是入站消息
    // 的 expiresAt；否则过期的审批请求仍可能被新的手机消息 approve。expired 不消费
    // messageId、不改 event.status、不清 pendingLocalApproval、不执行 approve/deny。
    if (Date.parse(event.expiresAt) <= Date.now()) {
      return reject("expired", "approval_request expired");
    }
    if (message.nonce !== event.nonce) {
      return reject("bad_signature", "approval_response nonce mismatch");
    }
    consume();
    event.status = message.approve ? "approved" : "rejected";
    return {
      kind: "approval_response",
      status: message.approve ? "approved" : "rejected",
      summary: message.approve
        ? "remote approval validated; local permission pipeline remains the execution boundary"
        : "remote approval rejected by user",
      evidenceCreated: false,
    };
  }
  if (message.kind === "natural_language_message") {
    const text = (message.text ?? "").trim();
    if (!text) {
      return reject("blocked", "natural_language_message is empty");
    }
    consume();
    return {
      kind: "natural_language_message",
      status: "accepted",
      summary: "remote natural-language message accepted; routing into local model main chain",
      routedText: text,
      evidenceCreated: false,
    };
  }
  consume();
  return {
    kind: "status_query",
    status: "accepted",
    summary: "remote status query accepted; returning redacted local status summary",
    evidenceCreated: false,
  };
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
