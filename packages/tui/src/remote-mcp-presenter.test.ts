import { defaultConfig } from "@linghun/config";
import { describe, expect, it } from "vitest";
import type { McpState, RemoteChannelState, RemoteEvent, RemoteState } from "./index.js";
import {
  formatMcpTools,
  formatRemoteStatus,
  formatRemoteTestResult,
} from "./remote-mcp-presenter.js";

const feishuChannel: RemoteChannelState = {
  id: "feishu",
  config: {
    ...defaultConfig.remote.channels.feishu,
    enabled: true,
    transport: "webhook_mock",
    bindingUserId: "user-1",
  },
  runtimeStatus: "ready",
  bindingStatus: "bound",
  transportStatus: "mock",
  nextAction: "/remote test feishu",
};

describe("remote MCP presenters", () => {
  it("formats remote status with webhook_mock boundary", () => {
    const remote: RemoteState = {
      enabled: true,
      channels: [feishuChannel],
      events: [],
      processedMessageIds: [],
      sessionDisabledChannelIds: [],
      pairings: [],
      inbox: [],
    };

    expect(formatRemoteStatus(remote)).toBe(
      [
        "Remote Channels：已开启；仅发送脱敏摘要/审批请求/结果报告。",
        "- 不发送完整 transcript、源码、日志、index result、evidence、API key/token 或 provider raw request。",
        "- feishu: ready; binding bound; transport webhook_mock/mock; last error none; next /remote test feishu",
        "- webhook_mock：diagnostic/test-only dry run，不代表真实 remote delivery PASS。",
        "- 主路径：/remote setup <channel> -> /remote test <channel> -> /remote status",
      ].join("\n"),
    );
  });

  it("formats remote test result without claiming real delivery", () => {
    const event: RemoteEvent = {
      id: "event-1",
      channel: "feishu",
      eventType: "approval_request",
      createdAt: "2026-05-23T00:00:00.000Z",
      expiresAt: "2026-05-23T00:05:00.000Z",
      nonce: "nonce-1",
      messageId: "message-1",
      source: "linghun-local",
      redactedSummary: "safe summary",
      refs: [],
      status: "sent",
    };

    expect(formatRemoteTestResult(feishuChannel, event)).toBe(
      [
        "Remote test 已发送：feishu",
        "- status: sent",
        "- summary: safe summary",
        "- next: /remote status",
        "- 本测试只使用脱敏摘要；webhook_mock 仅为诊断演练，不代表真实外网回调服务器已接入。",
      ].join("\n"),
    );
  });

  it("formats webhook_mock test result as a diagnostic dry run, not a real PASS", () => {
    const event: RemoteEvent = {
      id: "event-mock",
      channel: "feishu",
      eventType: "job_status",
      createdAt: "2026-05-23T00:00:00.000Z",
      expiresAt: "2026-05-23T00:05:00.000Z",
      nonce: "nonce-mock",
      messageId: "message-mock",
      source: "linghun-local",
      redactedSummary: "safe summary",
      refs: [],
      status: "mock",
      deliveryDetail: "webhook_mock diagnostic dry run — not a real remote delivery",
    };

    const text = formatRemoteTestResult(feishuChannel, event);
    expect(text).toContain("Remote test mock 演练（非真实投递）：feishu");
    expect(text).toContain("- status: mock");
    expect(text).toContain("webhook_mock diagnostic dry run");
    expect(text).not.toContain("已发送");
  });

  it("formats MCP tool placeholder summary", () => {
    const mcp: McpState = {
      enabled: true,
      servers: [],
      tools: [
        {
          server: "codebase-memory",
          name: "index_status",
          description: "Check index status",
          discovery: "placeholder",
          trusted: false,
          schemaLoaded: false,
          runtimeVersion: "unknown",
        },
      ],
    };

    expect(formatMcpTools(mcp)).toBe(
      [
        "MCP tools（稳定排序摘要，不输出完整 schema）",
        "- placeholder 表示安全占位摘要：未加载、未信任、不可执行真实 schema；schema loaded 只有在 discovery/doctor 成功后才会开启。",
        "- codebase-memory :: index_status — Check index status; discovery placeholder; trusted no; schema loaded no; runtime unknown",
      ].join("\n"),
    );
  });

  it("formats empty MCP tool summary", () => {
    const mcp: McpState = {
      enabled: true,
      servers: [],
      tools: [],
    };

    expect(formatMcpTools(mcp)).toBe(
      "MCP tools：暂无稳定工具摘要。可运行 /mcp doctor 检测本机 server；不会输出完整 tool schema。",
    );
  });
});
