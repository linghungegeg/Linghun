import type { McpState, RemoteChannelState, RemoteEvent, RemoteState } from "./index.js";

export function formatRemoteStatus(remote: RemoteState): string {
  const lines = [
    `Remote Channels：${remote.enabled ? "已开启" : "默认关闭"}；仅发送脱敏摘要/审批请求/结果报告。`,
    "- 不发送完整 transcript、源码、日志、index result、evidence、API key/token 或 provider raw request。",
  ];
  for (const channel of remote.channels) {
    lines.push(
      `- ${channel.id}: ${channel.runtimeStatus}; binding=${channel.bindingStatus}; transport=${channel.config.transport}/${channel.transportStatus}; lastError=${channel.lastError ?? "none"}; next=${channel.nextAction}`,
    );
  }
  if (remote.channels.some((channel) => channel.config.transport === "webhook_mock")) {
    lines.push("- webhook_mock：diagnostic/test-only dry run，不代表真实 remote delivery PASS。");
  }
  lines.push("- 主路径：/remote setup <channel> -> /remote test <channel> -> /remote status");
  return lines.join("\n");
}

export function formatRemoteTestResult(channel: RemoteChannelState, event: RemoteEvent): string {
  const ok = event.status === "sent";
  return [
    `Remote test ${ok ? "已发送" : "未发送"}：${channel.id}`,
    `- status: ${event.status}`,
    `- summary: ${event.redactedSummary}`,
    `- next: ${ok ? "/remote status" : channel.nextAction}`,
    "- 本测试只使用脱敏摘要；不代表真实外网回调服务器已接入。",
  ].join("\n");
}

export function formatMcpTools(mcp: McpState): string {
  if (mcp.tools.length === 0) {
    return "MCP tools：暂无稳定工具摘要。可运行 /mcp doctor 检测本机 server；不会输出完整 tool schema。";
  }
  return [
    "MCP tools（稳定排序摘要，不输出完整 schema）",
    "- placeholder 表示安全占位摘要：未加载、未信任、不可执行真实 schema；schemaLoaded=yes 只会在 discovery/doctor 成功后出现。",
    ...mcp.tools.map(
      (tool) =>
        `- ${tool.server} :: ${tool.name} — ${tool.description}; discovery=${tool.discovery ?? "placeholder"}; trusted=${tool.trusted ? "yes" : "no"}; schemaLoaded=${tool.schemaLoaded ? "yes" : "no"}; runtime=${tool.runtimeVersion ?? "unknown"}`,
    ),
  ].join("\n");
}
