import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig } from "@linghun/config";
import { createCacheFreshness } from "./cache-freshness.js";
import { collectLightHints, writeLightHintsForTest } from "./cache-command-runtime.js";
import { createCacheState, createRemoteState } from "./tui-state-runtime.js";
import {
  cancelRemotePairing,
  clearRemoteInbox,
  createRemotePairing,
  decideRemoteInbox,
  drainRemoteInbox,
  rejectRemoteInboxItem,
  validateRemotePairingCode,
} from "./remote-inbound-bridge-runtime.js";
import {
  classifyProviderFailure,
  formatProviderFailurePrimary,
} from "./request-lifecycle-presenter.js";
import {
  createIndexSafetyRepairPlan,
  createIndexTransientExcludes,
  scanIndexSafety,
  summarizeIndexResult,
} from "./index-result-presenter.js";
import type { TuiContext } from "./tui-context-runtime.js";
import type { RemoteInboundMessage } from "./tui-data-types.js";
import { describe, expect, it } from "vitest";

describe("Phase E request lifecycle provider failure coverage", () => {
  const cases: Array<[unknown, ReturnType<typeof classifyProviderFailure>]> = [
    [{ code: "PROVIDER_QUOTA_EXHAUSTED", message: "quota exhausted" }, "quota_or_balance_exhausted"],
    [{ status: 429, message: "too many requests" }, "rate_limit"],
    [{ message: "extended_thinking is unsupported_param" }, "reasoning_unsupported"],
    [{ code: "PROVIDER_STREAM_DECODE_ERROR", message: "bad frame" }, "transit"],
    [{ code: "PROVIDER_PARTIAL_TOOL_CALL", message: "unfinished tool call" }, "transit"],
    [{ code: "PROVIDER_AUTH_ERROR", message: "unauthorized" }, "auth"],
    [{ code: "MODEL_NOT_FOUND", message: "model not found" }, "not_found"],
    [{ status: 503, message: "service unavailable" }, "gateway"],
    [{ message: "request TIMEOUT" }, "timeout"],
    [Object.assign(new Error("aborted by user"), { code: "ABORT_ERR" }), "abort"],
    [{ code: "MODEL_TOOLS_UNSUPPORTED", message: "tools not supported" }, "schema"],
    [{ code: "PROVIDER_STREAM_ERROR", message: "plain stream failure" }, "transit"],
    [{ message: "unclassified provider issue" }, "generic"],
    [{ message: "余额不足，请充值" }, "quota_or_balance_exhausted"],
    [{ message: "eventstream CRC mismatch" }, "transit"],
    [{ message: "请求格式 tool_result 不兼容" }, "schema"],
  ];

  it.each(cases)("classifies %o as %s", (error, kind) => {
    expect(classifyProviderFailure(error)).toBe(kind);
  });

  it("formats primary failures without leaking raw internals", () => {
    const zh = formatProviderFailurePrimary(
      { code: "PROVIDER_STREAM_ERROR", message: "eventstream CRC mismatch" },
      "zh-CN",
    );
    const en = formatProviderFailurePrimary(
      { code: "PROVIDER_QUOTA_EXHAUSTED", message: "quota exhausted" },
      "en-US",
    );

    expect(zh).toContain("响应流传输失败");
    expect(en).toContain("quota");
    expect(en).not.toContain("PROVIDER_QUOTA_EXHAUSTED");
  });
});

describe("Phase E remote inbound bridge coverage", () => {
  it("creates, validates, binds, cancels, and rejects replayed pairings", () => {
    const remote = createRemoteState(defaultConfig);
    const channel = remote.channels.find((item) => item.id === "feishu");
    expect(channel).toBeTruthy();
    if (!channel) return;

    const created = createRemotePairing(
      remote,
      channel,
      "/repo",
      "session-1",
      Date.parse("2026-06-07T00:00:00.000Z"),
      "ABC123",
    );
    expect(created.status).toBe("created");
    const message = bindMessage(channel.id, "m-1", "/bind ABC123");
    const valid = validateRemotePairingCode(
      remote,
      channel,
      message,
      Date.parse("2026-06-07T00:01:00.000Z"),
    );
    expect(valid.status).toBe("valid");
    expect(cancelRemotePairing(remote, "dingtalk").status).toBe("unknown");
    expect(validateRemotePairingCode(remote, channel, bindMessage(channel.id, "m-2", "/bind BAD"))).toMatchObject({
      status: "unknown",
    });
    if (valid.status === "valid") {
      valid.pairing.status = "bound";
      expect(validateRemotePairingCode(remote, channel, message)).toMatchObject({
        status: "replayed",
      });
    }

    const second = createRemotePairing(remote, channel, "/repo", "session-1", Date.now(), "DEF456");
    expect(second.status).toBe("created");
    expect(cancelRemotePairing(remote, channel.id).status).toBe("cancelled");
  });

  it("routes idle inbound messages, queues busy turns, and drains/rejects inbox items", () => {
    const remote = createRemoteState(defaultConfig);
    const message = bindMessage("feishu", "m-normal", "继续检查");

    expect(decideRemoteInbox(remote, { ...message, kind: "status_query" }, {}).status).toBe(
      "status_only",
    );
    expect(decideRemoteInbox(remote, { ...message, kind: "approval_response", approve: true }, {}).status).toBe(
      "approval_only",
    );
    expect(decideRemoteInbox(remote, message, {}).status).toBe("route");

    const queued = decideRemoteInbox(remote, message, {
      activeModelTurn: true,
      sessionId: "session-1",
    });
    expect(queued.status).toBe("queued");
    expect(remote.inbox).toHaveLength(1);
    expect(rejectRemoteInboxItem(remote, remote.inbox[0]?.id ?? "")).toBe(true);
    expect(remote.inbox).toHaveLength(0);

    decideRemoteInbox(remote, message, { activeJob: true });
    expect(clearRemoteInbox(remote)).toBe(1);
    decideRemoteInbox(remote, message, { toolRunning: true });
    expect(drainRemoteInbox(remote)).toHaveLength(1);
    expect(remote.inbox).toHaveLength(0);
  });
});

describe("Phase E cache light hints coverage", () => {
  it("collects, prioritizes, dedupes, and writes light hints as notifications", () => {
    const context = minimalCacheContext();
    context.cache.history.push({
      turn: 1,
      model: "deepseek-chat",
      provider: "deepseek",
      inputTokens: 120_000,
      outputTokens: 1,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      cacheWriteTokensSource: "zero_reported",
      hitRate: 0.1,
      timestamp: Date.now(),
      source: "provider_usage",
      compacted: false,
      freshness: createCacheFreshness({
        systemPrompt: "changed",
        toolSchema: "changed",
        mcpToolList: [],
        model: "deepseek-chat",
        provider: "deepseek",
        projectRules: "rules",
        memory: "memory",
        compact: "compact",
        plugins: [],
      }),
    });
    context.cache.history[0]?.freshness.changedKeys.push("toolSchemaHash");

    const hints = collectLightHints(context);
    expect(hints.map((hint) => hint.dedupeKey)).toEqual(
      expect.arrayContaining([
        "cache-hit-low",
        "context-long",
        "cache-zero-create-with-read",
        "freshness-changed",
      ]),
    );

    const output = new MemoryOutput();
    writeLightHintsForTest(output, context);
    expect(context.notifications).toHaveLength(1);
    expect(context.notifications?.[0]?.key).toBe("lighthint:cache-hit-low");
    writeLightHintsForTest(output, context);
    expect(context.notifications?.map((item) => item.key)).toEqual([
      "lighthint:cache-hit-low",
      "lighthint:freshness-changed",
    ]);
    expect(new Set(context.notifications?.map((item) => item.key)).size).toBe(
      context.notifications?.length,
    );
    expect(output.text).toBe("");
  });
});

describe("Phase E index result presenter coverage", () => {
  it("summarizes architecture/search results and scans large generated index risks", async () => {
    expect(
      summarizeIndexResult("get_architecture", {
        project: "F-Linghun",
        total_nodes: 2,
        total_edges: 1,
        node_labels: [{ label: "Function", count: 2 }],
        edge_types: [{ type: "CALLS", count: 1 }],
      }),
    ).toContain("Function 2");
    expect(
      summarizeIndexResult("search_code", {
        total_results: 1,
        results: [{ path: "src/a.ts", symbol: "fn", kind: "function" }],
      }),
    ).toContain("symbol fn");

    const project = await mkdtemp(join(tmpdir(), "linghun-phase-e-index-"));
    await mkdir(join(project, "dist"), { recursive: true });
    await mkdir(join(project, "apps", "cli", "bundled", "codebase-memory"), { recursive: true });
    await writeFile(join(project, "big.log"), "x".repeat(1_000_010), "utf8");
    await writeFile(
      join(project, "apps", "cli", "bundled", "codebase-memory", "codebase-memory-mcp.exe"),
      "x".repeat(1_000_010),
      "utf8",
    );
    await writeFile(join(project, ".cbmignore"), "ignored.log\n", "utf8");
    await writeFile(join(project, "ignored.log"), "x".repeat(1_000_010), "utf8");

    const safety = await scanIndexSafety(project);
    expect(safety.riskyFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining(["dist/", "big.log", "apps/cli/bundled/codebase-memory/"]),
    );
    expect(safety.riskyFiles.map((file) => file.path)).not.toContain("ignored.log");
    expect(createIndexTransientExcludes(safety)).toEqual([...new Set(createIndexTransientExcludes(safety))]);
    await expect(createIndexSafetyRepairPlan(project, safety.riskyFiles)).resolves.toMatchObject({
      missingEntries: expect.arrayContaining(["apps/cli/bundled/codebase-memory/"]),
    });
  });
});

function bindMessage(
  channel: string,
  messageId: string,
  text: string,
): RemoteInboundMessage {
  return {
    kind: "natural_language_message",
    channel,
    messageId,
    nonce: `nonce-${messageId}`,
    source: `${channel}-source`,
    bindingUserId: `${channel}-user`,
    signature: "mock",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    receivedAt: new Date().toISOString(),
    origin: "fixture",
    text,
  };
}

function minimalCacheContext(): TuiContext {
  return {
    projectPath: process.cwd(),
    language: "zh-CN",
    config: defaultConfig,
    cache: createCacheState(process.cwd(), "deepseek-chat", [], defaultConfig),
  } as unknown as TuiContext;
}

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.text += chunk.toString();
    callback();
  }
}
