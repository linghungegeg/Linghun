import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { RemoteChannelType, RemoteEventType } from "@linghun/config";
import { showCommandPanel } from "./command-panel-runtime.js";
import {
  type FeishuLongConnectionHandle,
  startFeishuLongConnection,
} from "./feishu-long-connection-runtime.js";
import type { TuiContext } from "./index.js";
import { redactRemoteSummary, remoteTranscriptSummary } from "./permission-continuation-runtime.js";
import {
  cancelRemotePairing,
  clearRemoteInbox,
  createRemotePairing,
  createSignedRemoteInboundFixture,
  drainRemoteInbox,
  formatRemoteBridgeDoctor,
  formatRemoteInbox,
  formatRemotePairing,
  formatRemotePairingStatus,
  getRemoteBridgeDoctor,
  rejectRemoteInboxItem,
} from "./remote-inbound-bridge-runtime.js";
import {
  createDefaultReplBridgeSocketPath,
  createReplBridgeState,
  handleReplBridgeMessage,
  maybeRefreshJwtToken,
  startReplBridgeSocketServer,
} from "./remote-repl-bridge-runtime.js";
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
  handleRemoteInboundMessage?: (
    message: RemoteInboundMessage,
    context: TuiContext,
    gateway: undefined,
    output: Writable,
  ) => Promise<RemoteInboundDecision>;
  startFeishuLongConnection?: typeof startFeishuLongConnection;
};

let runtimeDeps: RemoteCommandRuntimeDeps | undefined;

// D.14E — 可注入的真实发送 transport deps；未配置时回退到真实网络/进程实现。
// 测试通过 sendRemoteEventReal 的 depsOverride 注入 stub，永不触网/触进程。
let remoteTransportDeps: RemoteTransportDeps | undefined;
const feishuLongConnectionHandles = new Map<string, FeishuLongConnectionHandle>();

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
  context.remote.localReplBridge = previous.localReplBridge;
  context.remote.localReplBridgeSocket = previous.localReplBridgeSocket;
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
          ? "Remote setup now recommends /remote bot setup <channel> — Ctrl+O for details."
          : "远程接入现在推荐 /remote bot setup <channel> — Ctrl+O 查看详情。",
      ],
      detailsText: [
        formatRemoteBotSetupDetails(context, args[1]),
        "",
        "Legacy /remote setup details（compatibility）",
        formatRemoteSetup(args[1], context),
      ].join("\n"),
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
    const result = await sendRemoteEventReal(context, event, undefined, context.tools.abortSignal);
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
  if (action === "events") {
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
  if (action === "inbox") {
    await handleRemoteInboxCommand(args.slice(1), context, output);
    return;
  }
  if (action === "bridge") {
    await handleRemoteBridgeCommand(args.slice(1), context, output);
    return;
  }
  if (action === "bot") {
    await handleRemoteBotCommand(args.slice(1), context, output);
    return;
  }
  writeLine(
    output,
    "用法：/remote bot doctor|setup|start|stop|pair|inbox <channel> | /remote setup <channel> | /remote test <channel> | /remote status | /remote doctor | /remote events | /remote inbox | /remote bridge doctor|pair|start|test-inbound|test-approval|test-status <channel> | /remote disable <channel>",
  );
}

async function handleRemoteBotCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "doctor";
  if (action === "inbox") {
    await handleRemoteInboxCommand(args.slice(1), context, output);
    return;
  }
  if (action === "doctor") {
    const channelArg = args[1];
    showCommandPanel(context, output, {
      title: "/remote bot doctor",
      tone: "neutral",
      summary: [formatRemoteBotDoctorSummary(context, channelArg)],
      detailsText: formatRemoteBotDoctorDetails(context, channelArg),
    });
    return;
  }
  if (action === "setup") {
    const channelArg = args[1];
    showCommandPanel(context, output, {
      title: "/remote bot setup",
      tone: "neutral",
      summary: [formatRemoteBotSetupSummary(context, channelArg)],
      detailsText: formatRemoteBotSetupDetails(context, channelArg),
    });
    return;
  }
  if (action === "start") {
    const channelArg = normalizeRemoteChannelId(args[1] ?? "");
    if (channelArg === "feishu") {
      const channel = findRemoteChannel(context, channelArg);
      if (!channel) {
        writeLine(output, "Remote bot start：未识别 Feishu Bot 配置。");
        return;
      }
      const result = await startRemoteFeishuBridge(context, output, channel, "bot");
      showCommandPanel(context, output, {
        title: "/remote bot start feishu",
        tone:
          result.status === "started" || result.status === "already_running"
            ? "neutral"
            : "warning",
        summary: [toRemoteBotStartSummary("feishu", result.status)],
        detailsText: [
          toRemoteBotStartSummary("feishu", result.status),
          result.detail,
          "Bot path: Feishu messages enter RemoteInboundMessage -> handleRemoteInboundMessage; no second executor.",
        ].join("\n"),
      });
      return;
    }
    showCommandPanel(context, output, {
      title: `/remote bot start ${channelArg || "<channel>"}`,
      tone: "warning",
      summary: [formatRemoteBotStartBlockedSummary(channelArg)],
      detailsText: [
        formatRemoteBotStartBlockedSummary(channelArg),
        formatRemoteBotSetupDetails(context, channelArg),
      ].join("\n"),
    });
    return;
  }
  if (action === "stop") {
    const channelArg = normalizeRemoteChannelId(args[1] ?? "");
    const stopped = await stopRemoteBotChannel(channelArg);
    showCommandPanel(context, output, {
      title: `/remote bot stop ${channelArg || "<channel>"}`,
      tone: "neutral",
      summary: [
        stopped
          ? `Remote Bot ${channelArg} stopped.`
          : `Remote Bot ${channelArg || "channel"} is not running.`,
      ],
      detailsText: stopped
        ? `Remote Bot ${channelArg} stopped.\nLong connection handle was closed in this process. Secrets were not printed.`
        : "No active long connection handle exists in this process.",
    });
    return;
  }
  if (action === "pair") {
    const channelArg = normalizeRemoteChannelId(args[1] ?? "");
    if (channelArg === "wechat") {
      showCommandPanel(context, output, {
        title: "/remote bot pair wechat",
        tone: "warning",
        summary: [
          "Personal WeChat Bot pairing is experimental and blocked until an opt-in plugin bridge exists.",
        ],
        detailsText: formatWechatBotExperimentalDetails(),
      });
      return;
    }
    const channel = findRemoteChannel(context, channelArg);
    if (!channel) {
      writeLine(
        output,
        "Remote bot pair：未识别通道。用法：/remote bot pair feishu|dingtalk|wechat",
      );
      return;
    }
    const pairing = createRemotePairing(
      context.remote,
      channel,
      context.projectPath,
      await deps().ensureSession(context),
    );
    await appendRemoteSystemEvent(
      context,
      `remote_bot_pair channel=${channel.id} status=${pairing.status} expiresAt=${
        pairing.status === "created" ? pairing.pairing.expiresAt : "none"
      }`,
      "info",
    );
    showCommandPanel(context, output, {
      title: `/remote bot pair ${channel.id}`,
      tone: pairing.status === "created" ? "neutral" : "warning",
      summary: [
        pairing.status === "created"
          ? `Bot pairing code ${pairing.pairing.code} — send /bind CODE from your Bot chat.`
          : pairing.summary,
      ],
      detailsText: [
        pairing.status === "created"
          ? `Bot pairing code ${pairing.pairing.code} — send /bind CODE from your Bot chat.`
          : pairing.summary,
        formatRemotePairing(pairing),
      ].join("\n"),
    });
    return;
  }
  writeLine(
    output,
    "用法：/remote bot doctor [channel] | /remote bot setup feishu|dingtalk|wechat | /remote bot start feishu|dingtalk|wechat | /remote bot stop <channel> | /remote bot pair <channel> | /remote bot inbox",
  );
}

async function handleRemoteInboxCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "list";
  let detail = formatRemoteInbox(context.remote);
  if (action === "clear") {
    const count = clearRemoteInbox(context.remote);
    detail = `Remote inbox cleared：${count}`;
  } else if (action === "reject") {
    const id = args[1] ?? "";
    detail = rejectRemoteInboxItem(context.remote, id)
      ? `Remote inbox rejected：${id}`
      : `Remote inbox item not found：${id}`;
  } else if (action === "drain") {
    const drained = drainRemoteInbox(context.remote);
    detail = `Remote inbox drain/export and clear：${drained.length}\n${drained
      .map((item) => `- ${item.id}: ${item.channel}; ${item.text}`)
      .join(
        "\n",
      )}\nThese messages were exported and cleared only; they were not sent to sendMessage.`;
  }
  await appendRemoteSystemEvent(
    context,
    `remote_inbox action=${action} size=${context.remote.inbox.length}`,
    "info",
  );
  showCommandPanel(context, output, {
    title: "/remote inbox",
    tone: "neutral",
    summary: [
      context.language === "en-US"
        ? `Remote inbox: ${context.remote.inbox.length} queued — Ctrl+O for details.`
        : `远程收件箱：${context.remote.inbox.length} 条排队 — Ctrl+O 查看详情。`,
    ],
    detailsText: detail,
  });
}

async function handleRemoteBridgeCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "doctor";
  if (action === "pair" && args[1] === "status") {
    showCommandPanel(context, output, {
      title: "/remote bridge pair status",
      tone: "neutral",
      summary: ["Remote pairing status — Ctrl+O for details."],
      detailsText: formatRemotePairingStatus(context.remote),
    });
    return;
  }
  if (action === "pair" && args[1] === "cancel") {
    const decision = cancelRemotePairing(context.remote, args[2]);
    await appendRemoteSystemEvent(context, `remote_pair_cancel status=${decision.status}`, "info");
    showCommandPanel(context, output, {
      title: "/remote bridge pair cancel",
      tone: decision.status === "cancelled" ? "neutral" : "warning",
      summary: [decision.summary],
      detailsText: decision.summary,
    });
    return;
  }
  if (action === "start") {
    const channel = findRemoteChannel(context, args[1]);
    if (!channel) {
      writeLine(output, "Remote bridge start：未识别通道。用法：/remote bridge start feishu");
      return;
    }
    if (channel.id !== "feishu" && channel.config.type !== "lark") {
      writeLine(output, "Remote bridge start：当前只支持 feishu/lark 长连接。");
      return;
    }
    const result = await startRemoteFeishuBridge(context, output, channel);
    showCommandPanel(context, output, {
      title: "/remote bridge start",
      tone:
        result.status === "started" || result.status === "already_running" ? "neutral" : "warning",
      summary: [result.summary],
      detailsText: result.detail,
    });
    return;
  }
  if (action === "local-register") {
    const clientId = args[1] ?? "local";
    const decision = handleReplBridgeMessage(ensureLocalReplBridge(context), context.remote, {
      type: "register",
      clientId,
    });
    showCommandPanel(context, output, {
      title: "/remote bridge local-register",
      tone: "neutral",
      summary: [`Local REPL bridge ${decision.status}: ${clientId}`],
      detailsText: JSON.stringify(decision, null, 2),
    });
    return;
  }
  if (action === "local-listen") {
    const socketPath = args[1] ?? createDefaultReplBridgeSocketPath(context.projectPath);
    if (context.remote.localReplBridgeSocket) {
      showCommandPanel(context, output, {
        title: "/remote bridge local-listen",
        tone: "neutral",
        summary: [`Local REPL bridge socket already listening: ${context.remote.localReplBridgeSocket.socketPath}`],
        detailsText: "Existing local REPL bridge socket is active in this process.",
      });
      return;
    }
    const handle = await startReplBridgeSocketServer({
      socketPath,
      bridge: () => ensureLocalReplBridge(context),
      remote: () => context.remote,
    });
    context.remote.localReplBridgeSocket = handle;
    showCommandPanel(context, output, {
      title: "/remote bridge local-listen",
      tone: "neutral",
      summary: [`Local REPL bridge socket listening: ${handle.socketPath}`],
      detailsText: [
        `socketPath: ${handle.socketPath}`,
        "Protocol: JSONL ReplBridgeMessage in, ReplBridgeDecision out.",
        "Messages still require /remote bridge local-route or an existing inbound handler path; no second executor was created.",
      ].join("\n"),
    });
    return;
  }
  if (action === "local-close") {
    const handle = context.remote.localReplBridgeSocket;
    if (!handle) {
      showCommandPanel(context, output, {
        title: "/remote bridge local-close",
        tone: "neutral",
        summary: ["Local REPL bridge socket is not listening."],
        detailsText: "No active local REPL bridge socket exists in this process.",
      });
      return;
    }
    await handle.close();
    context.remote.localReplBridgeSocket = undefined;
    showCommandPanel(context, output, {
      title: "/remote bridge local-close",
      tone: "neutral",
      summary: [`Local REPL bridge socket closed: ${handle.socketPath}`],
      detailsText: "Local REPL bridge socket closed; queued bridge state remains in this session.",
    });
    return;
  }
  if (action === "local-inbound") {
    const clientId = args[1] ?? "local";
    const text = args.slice(2).join(" ").trim();
    if (!text) {
      writeLine(output, "用法：/remote bridge local-inbound <clientId> <text>");
      return;
    }
    const decision = handleReplBridgeMessage(ensureLocalReplBridge(context), context.remote, {
      type: "inbound",
      clientId,
      text,
    });
    showCommandPanel(context, output, {
      title: "/remote bridge local-inbound",
      tone: decision.status === "accepted" ? "neutral" : "warning",
      summary: [`Local REPL bridge ${decision.status}: ${clientId}`],
      detailsText: JSON.stringify(decision, null, 2),
    });
    return;
  }
  if (action === "local-poll") {
    const clientId = args[1] ?? "local";
    const decision = handleReplBridgeMessage(ensureLocalReplBridge(context), context.remote, {
      type: "poll",
      clientId,
    });
    showCommandPanel(context, output, {
      title: "/remote bridge local-poll",
      tone: decision.status === "polled" ? "neutral" : "warning",
      summary: [
        decision.status === "polled"
          ? `Local REPL bridge polled: ${(decision.messages ?? []).length} message(s)`
          : `Local REPL bridge ${decision.status}`,
      ],
      detailsText: JSON.stringify(decision, null, 2),
    });
    return;
  }
  if (action === "local-route") {
    const clientId = args[1] ?? "local";
    const inbound = deps().handleRemoteInboundMessage;
    if (!inbound) {
      showCommandPanel(context, output, {
        title: "/remote bridge local-route",
        tone: "warning",
        summary: ["Local REPL bridge route blocked: inbound handler unavailable."],
        detailsText: "Local bridge messages must route through handleRemoteInboundMessage; no fallback executor was used.",
      });
      return;
    }
    const poll = handleReplBridgeMessage(ensureLocalReplBridge(context), context.remote, {
      type: "poll",
      clientId,
    });
    if (poll.status !== "polled") {
      showCommandPanel(context, output, {
        title: "/remote bridge local-route",
        tone: "warning",
        summary: [`Local REPL bridge ${poll.status}: ${clientId}`],
        detailsText: JSON.stringify(poll, null, 2),
      });
      return;
    }
    let routed = 0;
    const decisions: string[] = [];
    for (const message of poll.messages) {
      const decision = await inbound(message, context, undefined, output);
      decisions.push(`${message.messageId}: ${decision.status}`);
      if (decision.status === "accepted" || decision.status === "approved") {
        routed += 1;
        handleReplBridgeMessage(ensureLocalReplBridge(context), context.remote, {
          type: "acknowledge",
          clientId,
          messageId: message.messageId,
        });
      }
    }
    showCommandPanel(context, output, {
      title: "/remote bridge local-route",
      tone: "neutral",
      summary: [`Local REPL bridge routed: ${routed}/${poll.messages.length} message(s)`],
      detailsText: [
        "Messages were routed through handleRemoteInboundMessage; no second executor was used.",
        ...decisions,
      ].join("\n"),
    });
    return;
  }
  if (action === "local-ack") {
    const clientId = args[1] ?? "local";
    const messageId = args[2] ?? "";
    const decision = handleReplBridgeMessage(ensureLocalReplBridge(context), context.remote, {
      type: "acknowledge",
      clientId,
      messageId,
    });
    showCommandPanel(context, output, {
      title: "/remote bridge local-ack",
      tone: decision.status === "acknowledged" ? "neutral" : "warning",
      summary: [`Local REPL bridge ${decision.status}: ${messageId}`],
      detailsText: JSON.stringify(decision, null, 2),
    });
    return;
  }
  if (action === "local-heartbeat") {
    const clientId = args[1] ?? "local";
    const decision = handleReplBridgeMessage(ensureLocalReplBridge(context), context.remote, {
      type: "heartbeat",
      clientId,
      now: new Date().toISOString(),
    });
    showCommandPanel(context, output, {
      title: "/remote bridge local-heartbeat",
      tone: decision.status === "heartbeat" ? "neutral" : "warning",
      summary: [`Local REPL bridge ${decision.status}: ${clientId}`],
      detailsText: JSON.stringify(decision, null, 2),
    });
    return;
  }
  if (action === "local-stop") {
    const clientId = args[1] ?? "local";
    const decision = handleReplBridgeMessage(ensureLocalReplBridge(context), context.remote, {
      type: "stop",
      clientId,
      reason: "user requested stop",
    });
    showCommandPanel(context, output, {
      title: "/remote bridge local-stop",
      tone: "neutral",
      summary: [`Local REPL bridge ${decision.status}: ${clientId}`],
      detailsText: JSON.stringify(decision, null, 2),
    });
    return;
  }
  if (action === "local-deregister") {
    const clientId = args[1] ?? "local";
    const decision = handleReplBridgeMessage(ensureLocalReplBridge(context), context.remote, {
      type: "deregister",
      clientId,
    });
    showCommandPanel(context, output, {
      title: "/remote bridge local-deregister",
      tone: decision.status === "deregistered" ? "neutral" : "warning",
      summary: [`Local REPL bridge ${decision.status}: ${clientId}`],
      detailsText: JSON.stringify(decision, null, 2),
    });
    return;
  }
  if (action === "jwt-refresh-check") {
    const result = await maybeRefreshJwtToken({
      token: args[1],
      expiresAt: args[2],
      refresh: async () => ({
        token: "refreshed-token-redacted",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    showCommandPanel(context, output, {
      title: "/remote bridge jwt-refresh-check",
      tone: "neutral",
      summary: [`JWT refresh: ${result.refreshed ? "refreshed" : result.reason}`],
      detailsText: JSON.stringify(
        result.refreshed ? { ...result, token: "[REDACTED]" } : result,
        null,
        2,
      ),
    });
    return;
  }
  const channel = findRemoteChannel(context, args[1]);
  if (!channel) {
    writeLine(
      output,
      "Remote bridge：未识别通道。用法：/remote bridge doctor|pair|start|test-inbound|test-approval|test-status feishu|dingtalk|wecom",
    );
    return;
  }
  const report = getRemoteBridgeDoctor(context.remote, channel.id);
  if (action === "pair") {
    if (report.readiness === "notification-only") {
      showCommandPanel(context, output, {
        title: "/remote bridge pair",
        tone: "warning",
        summary: [
          context.language === "en-US"
            ? "Pairing blocked: webhook is notification-only."
            : "绑定被阻断：webhook 只能通知，不能真实绑定。",
        ],
        detailsText: [
          formatRemoteBridgeDoctor(report),
          "Pairing needs a platform app plus callback/daemon; do not treat webhook as mobile control.",
        ].join("\n"),
      });
      return;
    }
    const pairing = createRemotePairing(
      context.remote,
      channel,
      context.projectPath,
      await deps().ensureSession(context),
    );
    await appendRemoteSystemEvent(
      context,
      `remote_pair_create channel=${channel.id} status=${pairing.status} expiresAt=${
        pairing.status === "created" ? pairing.pairing.expiresAt : "none"
      }`,
      "info",
    );
    showCommandPanel(context, output, {
      title: "/remote bridge pair",
      tone: "neutral",
      summary: [
        pairing.status === "created"
          ? `Pairing code ${pairing.pairing.code} — Ctrl+O for details.`
          : pairing.summary,
      ],
      detailsText: formatRemotePairing(pairing),
    });
    return;
  }
  if (action === "doctor") {
    showCommandPanel(context, output, {
      title: "/remote bridge doctor",
      tone: report.readiness === "notification-only" ? "warning" : "neutral",
      summary: [
        context.language === "en-US"
          ? `Bridge ${channel.id}: ${report.readiness} — Ctrl+O for details.`
          : `手机桥接 ${channel.id}: ${report.readiness} — Ctrl+O 查看详情。`,
      ],
      detailsText: formatRemoteBridgeDoctor(report),
    });
    return;
  }
  if (action === "test-inbound" || action === "test-status" || action === "test-approval") {
    if (!report.canRunLocalFixture) {
      showCommandPanel(context, output, {
        title: `/remote bridge ${action}`,
        tone: "warning",
        summary: [
          context.language === "en-US"
            ? `Bridge fixture blocked: ${report.readiness} — Ctrl+O for details.`
            : `桥接 fixture 被阻断：${report.readiness} — Ctrl+O 查看详情。`,
        ],
        detailsText: formatRemoteBridgeDoctor(report),
      });
      return;
    }
    const kind =
      action === "test-approval"
        ? "approval_response"
        : action === "test-status"
          ? "status_query"
          : "natural_language_message";
    const event =
      kind === "approval_response"
        ? context.remote.events.find(
            (item) => item.channel === channel.id && item.eventType === "approval_request",
          )
        : undefined;
    const fixture = createSignedRemoteInboundFixture(channel, {
      kind,
      text: kind === "natural_language_message" ? "D.14F deterministic bridge fixture" : undefined,
      eventId: event?.id,
      nonce: event?.nonce,
      approve: kind === "approval_response" ? true : undefined,
    });
    const decision = processRemoteInbound(context, fixture);
    await appendRemoteSystemEvent(
      context,
      `remote_bridge_fixture channel=${channel.id} kind=${kind} status=${decision.status} summary=${decision.summary}`,
      decision.status === "accepted" || decision.status === "approved" ? "info" : "warning",
    );
    showCommandPanel(context, output, {
      title: `/remote bridge ${action}`,
      tone:
        decision.status === "accepted" || decision.status === "approved" ? "neutral" : "warning",
      summary: [
        context.language === "en-US"
          ? `Bridge fixture ${channel.id}: ${decision.status} — Ctrl+O for details.`
          : `桥接 fixture ${channel.id}: ${decision.status} — Ctrl+O 查看详情。`,
      ],
      detailsText: [
        formatRemoteBridgeDoctor(report),
        `fixture kind: ${kind}`,
        `decision: ${decision.status}`,
        `summary: ${decision.summary}`,
      ].join("\n"),
    });
    return;
  }
  writeLine(
    output,
    "用法：/remote bridge doctor|pair|start|test-inbound|test-approval|test-status feishu|dingtalk|wecom | local-listen|local-close|local-register|local-inbound|local-poll|local-route|local-ack|local-heartbeat|local-stop|local-deregister",
  );
}

function ensureLocalReplBridge(context: TuiContext) {
  if (!context.remote.localReplBridge) {
    context.remote.localReplBridge = createReplBridgeState();
  }
  return context.remote.localReplBridge;
}

async function startRemoteFeishuBridge(
  context: TuiContext,
  output: Writable,
  channel: RemoteChannelState,
  readinessMode: "bridge" | "bot" = "bridge",
): Promise<{
  status: "started" | "already_running" | "blocked" | "failed";
  summary: string;
  detail: string;
}> {
  const report =
    readinessMode === "bridge" ? getRemoteBridgeDoctor(context.remote, channel.id) : undefined;
  const botReadiness = readinessMode === "bot" ? getFeishuBotStartReadiness(channel) : undefined;
  const blockedDetail = botReadiness
    ? formatFeishuBotStartReadiness(botReadiness)
    : report
      ? formatRemoteBridgeDoctor(report)
      : "";
  if (
    botReadiness?.readiness === "notification-only" ||
    report?.readiness === "notification-only"
  ) {
    return {
      status: "blocked",
      summary: "Feishu bridge start blocked: webhook is notification-only.",
      detail: blockedDetail,
    };
  }
  if (botReadiness && !botReadiness.canStart) {
    return {
      status: "blocked",
      summary: `Feishu bridge start blocked: ${botReadiness.readiness}.`,
      detail: blockedDetail,
    };
  }
  if (report && report.readiness !== "ready-to-start" && report.readiness !== "fixture-ready") {
    return {
      status: "blocked",
      summary: `Feishu bridge start blocked: ${report.readiness}.`,
      detail: blockedDetail,
    };
  }
  const appId = resolveEnvRef(channel.config.appIdRef);
  const appSecret = resolveEnvRef(channel.config.appSecretRef);
  if (!appId || !appSecret) {
    const missing = [
      appId ? undefined : "LINGHUN_REMOTE_FEISHU_APP_ID",
      appSecret ? undefined : "LINGHUN_REMOTE_FEISHU_APP_SECRET",
    ].filter((item): item is string => Boolean(item));
    return {
      status: "blocked",
      summary: "Feishu bridge start blocked: app env missing.",
      detail: [
        blockedDetail,
        `missing env: ${missing.join(", ")}`,
        "Secret values are not printed.",
      ].join("\n"),
    };
  }
  if (feishuLongConnectionHandles.has(channel.id)) {
    return {
      status: "already_running",
      summary: "Feishu bridge already running.",
      detail: "Long connection handle is active in this process; secrets are not printed.",
    };
  }
  try {
    const start = deps().startFeishuLongConnection ?? startFeishuLongConnection;
    const handle = await start({
      appId,
      appSecret,
      onMessage: async (message) => {
        const inbound = deps().handleRemoteInboundMessage;
        if (!inbound) return;
        await inbound(message, context, undefined, output);
      },
    });
    feishuLongConnectionHandles.set(channel.id, handle);
    await appendRemoteSystemEvent(
      context,
      `remote_bridge_start channel=${channel.id} status=started`,
      "info",
    );
    return {
      status: "started",
      summary: "Feishu bridge started: waiting for mobile messages.",
      detail: [
        "Long connection started with official SDK; secrets are not printed.",
        botReadiness ? formatFeishuBotStartReadiness(botReadiness) : undefined,
      ]
        .filter((item): item is string => Boolean(item))
        .join("\n"),
    };
  } catch {
    await appendRemoteSystemEvent(
      context,
      `remote bridge start: channel ${channel.id}; status failed`,
      "warning",
    );
    return {
      status: "failed",
      summary: "Feishu bridge start failed: platform connection rejected or unavailable.",
      detail: [
        blockedDetail,
        "Check Feishu app credentials, long connection event subscription, bot ability, and message permissions.",
      ].join("\n"),
    };
  }
}

type FeishuBotStartReadiness = {
  readiness:
    | "ready-to-start"
    | "bound-ready"
    | "needs-app-id"
    | "needs-app-secret"
    | "needs-env"
    | "needs-event-subscription"
    | "notification-only";
  canStart: boolean;
  missingEnv: string[];
};

function getFeishuBotStartReadiness(channel: RemoteChannelState): FeishuBotStartReadiness {
  if (channel.config.transport === "webhook" || channel.config.transport === "webhook_mock") {
    return { readiness: "notification-only", canStart: false, missingEnv: [] };
  }
  if (channel.config.transport !== "official_cli") {
    return { readiness: "needs-event-subscription", canStart: false, missingEnv: [] };
  }
  if (
    channel.config.inboundMode !== "callback" ||
    channel.config.callbackEndpoint !== "feishu-long-connection"
  ) {
    return { readiness: "needs-event-subscription", canStart: false, missingEnv: [] };
  }
  if (!channel.config.appIdRef) {
    return { readiness: "needs-app-id", canStart: false, missingEnv: [] };
  }
  if (!channel.config.appSecretRef) {
    return { readiness: "needs-app-secret", canStart: false, missingEnv: [] };
  }
  const missingEnv = [channel.config.appIdRef, channel.config.appSecretRef].filter(
    (ref) => !resolveEnvRef(ref),
  );
  if (missingEnv.length) {
    return { readiness: "needs-env", canStart: false, missingEnv };
  }
  if (channel.config.bindingUserId && channel.config.trustedSources.length > 0) {
    return { readiness: "bound-ready", canStart: true, missingEnv: [] };
  }
  return { readiness: "ready-to-start", canStart: true, missingEnv: [] };
}

function formatFeishuBotStartReadiness(readiness: FeishuBotStartReadiness): string {
  const lines = [
    "Feishu Bot start readiness",
    `- readiness: ${readiness.readiness}`,
    `- can start: ${readiness.canStart ? "yes" : "no"}`,
  ];
  if (readiness.missingEnv.length) {
    lines.push(`- missing env: ${readiness.missingEnv.join(", ")}`);
  }
  lines.push("- secret values are not printed.");
  lines.push("- ready-to-start means Bot can run and wait for /bind CODE.");
  lines.push(
    "- bound/ready means ordinary mobile messages can pass binding/trusted-source checks.",
  );
  lines.push("- webhook path remains notification-only.");
  return lines.join("\n");
}

async function stopRemoteBotChannel(channelId: string): Promise<boolean> {
  const handle = feishuLongConnectionHandles.get(channelId);
  if (!handle) return false;
  await handle.close();
  feishuLongConnectionHandles.delete(channelId);
  return true;
}

function resolveEnvRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return process.env[ref];
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
    "推荐入口：/remote bot doctor；旧 /remote bridge 命令保留兼容。",
  ];
  for (const channel of context.remote.channels) {
    const grade = getRemoteCapabilityGrade(channel);
    const bridge = getRemoteBridgeDoctor(context.remote, channel.id);
    lines.push(`- ${channel.id}: ${channel.runtimeStatus}`);
    lines.push(`  binding: ${channel.bindingStatus}`);
    lines.push(`  transport: ${channel.config.transport}; status ${channel.transportStatus}`);
    lines.push(`  capability: ${grade.grade} — ${grade.reason}`);
    lines.push(`  bridge: ${bridge.readiness}; ${bridge.nextAction}`);
    lines.push(`  last error: ${channel.lastError ?? "none"}`);
    lines.push(`  allowed events: ${channel.config.allowedEventTypes.join(", ")}`);
    lines.push(`  next action: ${channel.nextAction}`);
  }
  lines.push(
    "Secrets/endpoints are redacted. webhook/webhook_mock 仅单向通知；审批/自然语言回传需官方 CLI/应用入站能力。",
  );
  return lines.join("\n");
}

function formatRemoteBotDoctorSummary(context: TuiContext, channelArg: string | undefined): string {
  const channels = selectBotChannels(context, channelArg);
  if (channels.length === 0 && normalizeRemoteChannelId(channelArg ?? "") === "wechat") {
    return "Personal WeChat Bot: experimental blocked.";
  }
  if (channels.length === 0) return "Remote Bot doctor: choose feishu, dingtalk, or wechat.";
  return channels
    .map((channel) => `${formatBotChannelName(channel.id)}: ${getRemoteBotUserStatus(channel)}`)
    .join("；");
}

function formatRemoteBotDoctorDetails(context: TuiContext, channelArg: string | undefined): string {
  const normalized = normalizeRemoteChannelId(channelArg ?? "");
  if (normalized === "wechat") return formatWechatBotExperimentalDetails();
  const channels = selectBotChannels(context, channelArg);
  if (channels.length === 0) {
    return "Remote Bot doctor：请选择 feishu、dingtalk 或 wechat。";
  }
  const lines = [
    "Remote Bot doctor（普通视图只显示 Bot 状态；底层 bridge 诊断请用 /remote bridge doctor）",
  ];
  for (const channel of channels) {
    const status = getRemoteBotUserStatus(channel);
    lines.push(`- ${formatBotChannelName(channel.id)}: ${status}`);
    lines.push(`  setup: /remote bot setup ${channel.id}`);
    lines.push(`  start: /remote bot start ${channel.id}`);
    lines.push(`  pair: /remote bot pair ${channel.id}`);
    if (channel.id === "feishu") {
      lines.push(
        "  needs: App ID, App Secret, Bot enabled, long connection, message receive event.",
      );
      lines.push(
        `  readiness: ${formatFeishuBotStartReadiness(getFeishuBotStartReadiness(channel)).replace(/\n/g, "\n  ")}`,
      );
    } else if (channel.id === "dingtalk") {
      lines.push("  needs: Client ID, Client Secret, robot Stream mode, published app.");
      lines.push("  real Stream smoke: NOT RUN without credentials and a published DingTalk bot.");
    }
    lines.push(
      `  pairing: ${channel.config.bindingUserId && channel.config.trustedSources.length > 0 ? "complete" : "needed"}`,
    );
  }
  lines.push(
    "Secrets, endpoints, trusted source lists, binding ids, callback refs, QR/session tokens, and raw payloads are redacted.",
  );
  lines.push(
    "Webhook notification remains notification-only; Bot inbound must enter the existing RemoteInboundMessage main chain.",
  );
  return lines.join("\n");
}

function formatRemoteBotSetupSummary(context: TuiContext, channelArg: string | undefined): string {
  const normalized = normalizeRemoteChannelId(channelArg ?? "");
  if (normalized === "wechat") return "Personal WeChat Bot setup: experimental opt-in only.";
  const channel = findRemoteChannel(context, normalized);
  if (!channel) return "Remote Bot setup: choose feishu, dingtalk, or wechat.";
  return `${formatBotChannelName(channel.id)} setup: ${getRemoteBotUserStatus(channel)}.`;
}

function formatRemoteBotSetupDetails(context: TuiContext, channelArg: string | undefined): string {
  const normalized = normalizeRemoteChannelId(channelArg ?? "");
  if (normalized === "wechat") return formatWechatBotExperimentalDetails();
  const channel = findRemoteChannel(context, normalized);
  if (!channel) {
    return "Remote Bot setup：请选择 feishu、dingtalk 或 wechat。示例：/remote bot setup feishu";
  }
  if (channel.id === "feishu") return formatFeishuBotSetupDetails(channel);
  if (channel.id === "dingtalk") return formatDingTalkBotSetupDetails(channel);
  return "Enterprise WeChat is future/not implemented in this Bot productization stage.";
}

function formatFeishuBotSetupDetails(channel: RemoteChannelState): string {
  return [
    "Feishu Bot setup",
    "- Prepare a Feishu/Lark app with Bot enabled.",
    "- Enable long connection and subscribe to im.message.receive_v1.",
    "- Set env refs: LINGHUN_REMOTE_FEISHU_APP_ID and LINGHUN_REMOTE_FEISHU_APP_SECRET.",
    "- Webhook notification is optional and not required for mobile control.",
    "- Start: /remote bot start feishu.",
    "- Pair from the Bot chat: /remote bot pair feishu, then send /bind CODE.",
    `- Current Bot status: ${getRemoteBotUserStatus(channel)}.`,
    "- Secret values are never printed or stored in reports.",
  ].join("\n");
}

function formatDingTalkBotSetupDetails(channel: RemoteChannelState): string {
  return [
    "DingTalk Bot setup",
    "- Official Stream path uses the dingtalk-stream SDK and Client ID / Client Secret.",
    "- In DingTalk developer console, enable robot message receiving, choose Stream mode, and publish the app.",
    "- Robot message topic: /v1.0/im/bot/messages/get.",
    "- Card callback topic: /v1.0/card/instances/callback; advanced cards must set callbackType=STREAM.",
    "- Configure env refs as LINGHUN_REMOTE_DINGTALK_CLIENT_ID and LINGHUN_REMOTE_DINGTALK_CLIENT_SECRET.",
    "- Current build has offline adapter normalization only; real DingTalk Stream start is NOT RUN without SDK wiring and credentials.",
    `- Current Bot status: ${getRemoteBotUserStatus(channel)}.`,
    "- sessionWebhook and Client Secret are treated as secrets and never persisted in summaries.",
  ].join("\n");
}

function formatWechatBotExperimentalDetails(): string {
  return [
    "Personal WeChat Bot setup: experimental",
    "- Default: blocked. Set LINGHUN_REMOTE_WECHAT_EXPERIMENTAL=1 only after accepting QR-login, third-party puppet/provider, account restriction, token, and session risks.",
    "- No Wechaty/PadLocal dependency is bundled in Linghun core in this stage.",
    "- A real plugin bridge must provide proof before messages can become RemoteInboundMessage.",
    "- QR payloads, QR images, session files, wxid/openid/unionid, puppet tokens, cookies, and device data must be redacted.",
    "- No fake WeChat inbound PASS is allowed; without a real opted-in bridge, /remote bot start wechat remains blocked.",
  ].join("\n");
}

function formatRemoteBotStartBlockedSummary(channelId: string): string {
  if (channelId === "dingtalk")
    return "DingTalk Bot start blocked: Stream SDK wiring and real credentials are not configured.";
  if (channelId === "wechat") {
    return process.env.LINGHUN_REMOTE_WECHAT_EXPERIMENTAL === "1"
      ? "Personal WeChat Bot start blocked: experimental plugin bridge is not installed."
      : "Personal WeChat Bot start blocked: experimental opt-in is disabled.";
  }
  return "Remote Bot start blocked: choose feishu, dingtalk, or wechat.";
}

function toRemoteBotStartSummary(
  channelId: string,
  status: "started" | "already_running" | "blocked" | "failed",
): string {
  if (status === "started")
    return `${formatBotChannelName(channelId)} started; waiting for mobile messages.`;
  if (status === "already_running")
    return `${formatBotChannelName(channelId)} Bot is already running.`;
  if (status === "failed")
    return `${formatBotChannelName(channelId)} Bot start failed; check app settings.`;
  return `${formatBotChannelName(channelId)} Bot start blocked; finish setup first.`;
}

function selectBotChannels(
  context: TuiContext,
  channelArg: string | undefined,
): RemoteChannelState[] {
  const normalized = normalizeRemoteChannelId(channelArg ?? "");
  if (normalized) {
    const channel = findRemoteChannel(context, normalized);
    return channel ? [channel] : [];
  }
  return context.remote.channels.filter(
    (channel) => channel.id === "feishu" || channel.id === "dingtalk",
  );
}

function getRemoteBotUserStatus(channel: RemoteChannelState): string {
  const report = getRemoteBridgeDoctor(
    {
      enabled: true,
      channels: [channel],
      events: [],
      processedMessageIds: [],
      sessionDisabledChannelIds: [],
      pairings: [],
      inbox: [],
    },
    channel.id,
  );
  if (channel.id === "feishu") {
    const readiness = getFeishuBotStartReadiness(channel);
    if (feishuLongConnectionHandles.has(channel.id)) return "running";
    if (readiness.readiness === "needs-app-id") return "needs app id";
    if (readiness.readiness === "needs-app-secret") return "needs app secret";
    if (readiness.readiness === "needs-env") return "needs app env";
    if (readiness.readiness === "notification-only") return "notification-only";
    if (readiness.readiness === "ready-to-start") return "ready-to-start";
    if (readiness.readiness === "bound-ready") return "bound/ready";
    return "needs event subscription";
  }
  if (channel.id === "dingtalk") {
    if (!channel.config.appIdRef) return "needs client id";
    if (!channel.config.appSecretRef && !channel.config.tokenRef) return "needs client secret";
    if (report.readiness === "needs-daemon") return "needs stream permission";
    return "stream adapter not connected";
  }
  return "future/not implemented";
}

function formatBotChannelName(channelId: string): string {
  if (channelId === "feishu") return "Feishu Bot";
  if (channelId === "dingtalk") return "DingTalk Bot";
  if (channelId === "wechat") return "Personal WeChat Bot";
  return `${channelId} Bot`;
}

export type RemoteCapabilityGrade =
  | "notification-only"
  | "needs-app-setup"
  | "needs-dingtalk-app"
  | "needs-wecom-app"
  | "needs-daemon"
  | "approval-capable"
  | "stream-callback-capable"
  | "app-callback-capable"
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
    if (!channel.config.appIdRef || !channel.config.appSecretRef) {
      return {
        grade: "needs-app-setup",
        reason: "Feishu/Lark 入站需要 appId/appSecret 引用和事件订阅配置；未配置不能显示 ready",
      };
    }
    return {
      grade: "full-mobile-control-capable",
      reason: "官方应用事件/回调或 CLI 消费可接入审批与自然语言；真实手机入站仍需 callback/daemon",
    };
  }
  if (type === "wecom" || type === "enterprise-wechat") {
    if (!channel.config.appIdRef && !channel.config.tokenRef) {
      return {
        grade: "needs-wecom-app",
        reason: "企业微信入站需要应用回调或 CLI poll 凭证；未配置显示 needs-wecom-app",
      };
    }
    return {
      grade: "natural-language-inbound-capable",
      reason: "应用回调/CLI poll 可接收自然语言；webhook 仍仅通知",
    };
  }
  if (!channel.config.appIdRef && !channel.config.tokenRef) {
    return {
      grade: "needs-dingtalk-app",
      reason: "钉钉入站/审批需要应用或 Stream 配置；未配置显示 needs-dingtalk-app",
    };
  }
  return {
    grade: "approval-capable",
    reason: "应用/Stream 配置后可做审批回传；实时消息需 daemon 或 callback",
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
        "appIdRef/appSecretRef 或 tokenRef",
        Boolean(config.appIdRef || config.tokenRef) &&
          ((config.type !== "feishu" && config.type !== "lark") || Boolean(config.appSecretRef)),
        "填环境变量引用，不填明文；未配置时 bridge 显示 needs-app-setup",
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
    lines.push(
      field(
        "encryptKeyRef / verificationTokenRef",
        config.type === "feishu" || config.type === "lark"
          ? config.callbackEndpoint === "feishu-long-connection" ||
              Boolean(config.encryptKeyRef && config.verificationTokenRef)
          : true,
        "Feishu/Lark 公网 callback 需要事件回调校验引用；长连接不需要",
      ),
    );
  }
  lines.push(
    `- 当前状态：runtime ${channel.runtimeStatus}; binding ${channel.bindingStatus}; transport ${config.transport}/${channel.transportStatus}`,
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
  signal?: AbortSignal,
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
    const result = await deliverWebhook(build.request, transport.fetch, signal);
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
    return isRemoteMockSignatureAllowed() && message.signature === `mock:${event.messageId}:${event.nonce}`;
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
    return (
      isRemoteMockSignatureAllowed() &&
      message.origin === "fixture" &&
      message.signature === `mock:inbound:${message.messageId}:${message.nonce}`
    );
  }
  return typeof message.signature === "string" && message.signature.startsWith("ref:");
}

function isRemoteMockSignatureAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

// D.14E — 远程入站统一入口。三类入站（approval_response / natural_language_message /
// status_query）必须先全部通过本地校验，再交回本地主链/权限管道。本函数不执行任何
// 工具/Bash/写文件/Git，不清空 pendingLocalApproval；natural_language_message 通过后
// 只返回 routedText，由 index.ts glue 投回本地模型主链（无本地关键词截获、无第二套执行器）。
export function processRemoteInbound(
  context: TuiContext,
  message: RemoteInboundMessage,
): RemoteInboundDecision {
  const envelope = validateRemoteInboundEnvelope(context, message);
  if (envelope.status !== "envelope_accepted") return envelope;
  const channel = envelope.channel;
  const consume = (): void => consumeRemoteInboundMessage(context, message.messageId);
  if (message.kind === "approval_response") {
    // plan 模式恒只读：远程 approve 不能执行任何写操作。pending approval 在 plan
    // 模式下只会是 mutating 操作，因此直接在边界拒绝，不消费 nonce。
    if (context.permissionMode === "plan") {
      return {
        kind: message.kind,
        status: "blocked",
        summary:
          "plan mode keeps writes read-only; remote approval cannot execute mutating operations",
        evidenceCreated: false,
      };
    }
    if (!context.pendingLocalApproval) {
      return {
        kind: message.kind,
        status: "no_pending_approval",
        summary: "no local pending approval to resume",
        evidenceCreated: false,
      };
    }
    const event = message.eventId
      ? context.remote.events.find((item) => item.id === message.eventId)
      : undefined;
    if (!event || event.eventType !== "approval_request") {
      return {
        kind: message.kind,
        status: "blocked",
        summary: "approval_response does not match a known approval_request",
        evidenceCreated: false,
      };
    }
    // D.14E 小返修 — 必须校验被引用的 approval_request 自身是否过期，而不只是入站消息
    // 的 expiresAt；否则过期的审批请求仍可能被新的手机消息 approve。expired 不消费
    // messageId、不改 event.status、不清 pendingLocalApproval、不执行 approve/deny。
    if (Date.parse(event.expiresAt) <= Date.now()) {
      return {
        kind: message.kind,
        status: "expired",
        summary: "approval_request expired",
        evidenceCreated: false,
      };
    }
    if (message.nonce !== event.nonce) {
      return {
        kind: message.kind,
        status: "bad_signature",
        summary: "approval_response nonce mismatch",
        evidenceCreated: false,
      };
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
      return {
        kind: message.kind,
        status: "blocked",
        summary: "natural_language_message is empty",
        evidenceCreated: false,
      };
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
  void channel;
  consume();
  return {
    kind: "status_query",
    status: "accepted",
    summary: "remote status query accepted; returning redacted local status summary",
    evidenceCreated: false,
  };
}

export function validateRemoteInboundEnvelope(
  context: TuiContext,
  message: RemoteInboundMessage,
): RemoteInboundDecision | { status: "envelope_accepted"; channel: RemoteChannelState } {
  const channel = context.remote.channels.find((item) => item.id === message.channel);
  const reject = (
    status: RemoteInboundDecision["status"],
    summary: string,
  ): RemoteInboundDecision => ({ kind: message.kind, status, summary, evidenceCreated: false });
  if (message.channel === "local-repl") {
    if (message.origin !== "adapter" || message.source !== "local-repl") {
      return reject("bad_signature", "local REPL bridge proof is invalid");
    }
    if (Date.parse(message.expiresAt) <= Date.now()) {
      return reject("expired", "local REPL bridge message expired");
    }
    if (context.remote.processedMessageIds.includes(message.messageId)) {
      return reject("replayed", "local REPL bridge message replayed");
    }
    const client = context.remote.localReplBridge?.clients.find(
      (item) => item.active && item.clientId === message.bindingUserId,
    );
    if (!client || !client.queue.some((item) => item.messageId === message.messageId)) {
      return reject("wrong_binding", "local REPL bridge client/message mismatch");
    }
    return { status: "envelope_accepted", channel: createLocalReplBridgeChannel() };
  }
  if (!channel || !canValidateRemoteInboundEnvelope(channel)) {
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
  return { status: "envelope_accepted", channel };
}

function createLocalReplBridgeChannel(): RemoteChannelState {
  return {
    id: "local-repl",
    config: {
      enabled: true,
      type: "lark",
      transport: "official_cli",
      redactionPolicy: "summary_only",
      allowedEventTypes: [],
      trustedSources: ["local-repl"],
      inboundMode: "callback",
      bindingUserId: "local-repl",
    },
    runtimeStatus: "ready",
    bindingStatus: "bound",
    transportStatus: "ready",
    nextAction: "/remote bridge local-route",
  };
}

export function validateRemotePairingEnvelope(
  context: TuiContext,
  message: RemoteInboundMessage,
): RemoteInboundDecision | { status: "envelope_accepted"; channel: RemoteChannelState } {
  const channel = context.remote.channels.find((item) => item.id === message.channel);
  const reject = (
    status: RemoteInboundDecision["status"],
    summary: string,
  ): RemoteInboundDecision => ({ kind: message.kind, status, summary, evidenceCreated: false });
  if (!channel || !canValidateRemoteInboundEnvelope(channel)) {
    return reject("channel_not_ready", "remote channel is not ready");
  }
  if (
    channel.config.transport !== "official_cli" ||
    !channel.config.inboundMode ||
    channel.config.inboundMode === "none"
  ) {
    return reject("inbound_disabled", "remote channel is notification-only; inbound is disabled");
  }
  if (Date.parse(message.expiresAt) <= Date.now()) {
    return reject("expired", "remote pairing message expired");
  }
  if (context.remote.processedMessageIds.includes(message.messageId)) {
    return reject("replayed", "remote pairing message replayed");
  }
  if (!verifyRemoteInboundSignature(channel, message)) {
    return reject("bad_signature", "remote pairing signature check failed");
  }
  return { status: "envelope_accepted", channel };
}

function canValidateRemoteInboundEnvelope(channel: RemoteChannelState): boolean {
  if (channel.runtimeStatus === "ready") return true;
  if (channel.runtimeStatus !== "blocked") return false;
  if (channel.lastError !== "not_bound" && channel.lastError !== "source_not_trusted") return false;
  return (
    channel.config.transport === "official_cli" &&
    Boolean(channel.config.inboundMode && channel.config.inboundMode !== "none")
  );
}

export function consumeRemoteInboundMessage(context: TuiContext, messageId: string): void {
  context.remote.processedMessageIds.unshift(messageId);
  context.remote.processedMessageIds = context.remote.processedMessageIds.slice(0, 50);
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
