import { createHmac } from "node:crypto";
import { defaultConfig } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteChannelState, RemoteEvent } from "./index.js";
import {
  type RemoteCliRunner,
  type RemoteFetch,
  buildOfficialCliInvocation,
  buildWebhookRequest,
  deliverOfficialCli,
  deliverWebhook,
  defaultRemoteTransportDeps,
} from "./remote-transport.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function channel(
  type: RemoteChannelState["config"]["type"],
  overrides: Partial<RemoteChannelState["config"]> = {},
): RemoteChannelState {
  const base =
    defaultConfig.remote.channels[
      type === "lark" ? "feishu" : type === "enterprise-wechat" ? "wecom" : type
    ];
  return {
    id: type,
    config: {
      ...(base ?? defaultConfig.remote.channels.feishu),
      type,
      enabled: true,
      ...overrides,
    },
    runtimeStatus: "ready",
    bindingStatus: "bound",
    transportStatus: "ready",
    nextAction: "/remote status",
  };
}

function event(summary = "redacted summary only"): RemoteEvent {
  return {
    id: "evt-1",
    channel: "feishu",
    eventType: "job_status",
    createdAt: "2026-05-31T00:00:00.000Z",
    expiresAt: "2026-05-31T00:05:00.000Z",
    nonce: "nonce-1",
    messageId: "msg-1",
    source: "linghun-local",
    redactedSummary: summary,
    refs: [],
    status: "pending",
  };
}

describe("D.14E remote transport — webhook payload builders", () => {
  const NOW = 1_700_000_000_000;

  it("feishu uses msg_type/content text and signs with timestamp\\nsecret over empty body", () => {
    const build = buildWebhookRequest(
      channel("feishu", {
        transport: "webhook",
        endpoint: "https://open.feishu.cn/open-apis/bot/v2/hook/tok",
      }),
      event(),
      "feishu-secret",
      NOW,
    );
    expect(build.ok).toBe(true);
    if (!build.ok) throw new Error("expected ok");
    const body = JSON.parse(build.request.body) as Record<string, unknown>;
    expect(body.msg_type).toBe("text");
    expect((body.content as { text: string }).text).toBe("redacted summary only");
    const expectedTs = String(Math.floor(NOW / 1000));
    const expectedSign = createHmac("sha256", `${expectedTs}\n${feishuSecret()}`)
      .update("")
      .digest("base64");
    expect(body.timestamp).toBe(expectedTs);
    expect(body.sign).toBe(expectedSign);
    // Secret never appears in URL or body.
    expect(build.request.url).not.toContain("feishu-secret");
    expect(build.request.body).not.toContain("feishu-secret");
  });

  it("feishu omits sign when no signing secret", () => {
    const build = buildWebhookRequest(
      channel("feishu", {
        transport: "webhook",
        endpoint: "https://open.feishu.cn/open-apis/bot/v2/hook/tok",
      }),
      event(),
      undefined,
      NOW,
    );
    if (!build.ok) throw new Error("expected ok");
    const body = JSON.parse(build.request.body) as Record<string, unknown>;
    expect(body.sign).toBeUndefined();
    expect(body.timestamp).toBeUndefined();
  });

  it("dingtalk uses msgtype/text and appends timestamp+sign (ms, secret as key) to URL", () => {
    const build = buildWebhookRequest(
      channel("dingtalk", {
        transport: "webhook",
        endpoint: "https://oapi.dingtalk.com/robot/send?access_token=tok",
      }),
      event(),
      "ding-secret",
      NOW,
    );
    if (!build.ok) throw new Error("expected ok");
    const body = JSON.parse(build.request.body) as Record<string, unknown>;
    expect(body.msgtype).toBe("text");
    expect((body.text as { content: string }).content).toBe("redacted summary only");
    const raw = createHmac("sha256", "ding-secret")
      .update(`${NOW}\n${"ding-secret"}`)
      .digest("base64");
    expect(build.request.url).toContain(`timestamp=${NOW}`);
    expect(build.request.url).toContain(`sign=${encodeURIComponent(raw)}`);
    // Plaintext secret never leaks into the URL or body.
    expect(build.request.body).not.toContain("ding-secret");
  });

  it("wecom uses msgtype/text and has NO HMAC sign (security is the URL key)", () => {
    const build = buildWebhookRequest(
      channel("wecom", {
        transport: "webhook",
        endpoint: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=KEY",
      }),
      event(),
      "wecom-secret",
      NOW,
    );
    if (!build.ok) throw new Error("expected ok");
    const body = JSON.parse(build.request.body) as Record<string, unknown>;
    expect(body.msgtype).toBe("text");
    expect(body.sign).toBeUndefined();
    expect(body.timestamp).toBeUndefined();
    expect(build.request.url).toBe("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=KEY");
  });

  it("reports missing endpoint instead of guessing", () => {
    const build = buildWebhookRequest(
      channel("feishu", { transport: "webhook" }),
      event(),
      undefined,
      NOW,
    );
    expect(build).toEqual({ ok: false, reason: "missing_endpoint" });
  });

  it("blocks signing-secret channels when the secret is unresolved", () => {
    const build = buildWebhookRequest(
      channel("feishu", {
        transport: "webhook",
        endpoint: "https://open.feishu.cn/open-apis/bot/v2/hook/tok",
        signingSecretRef: "FEISHU_SIGNING_SECRET",
      }),
      event(),
      undefined,
      NOW,
    );
    expect(build).toEqual({ ok: false, reason: "missing_signing_secret" });
  });

  it("payload body carries only the redacted summary, never raw secrets", () => {
    const build = buildWebhookRequest(
      channel("feishu", {
        transport: "webhook",
        endpoint: "https://open.feishu.cn/open-apis/bot/v2/hook/tok",
      }),
      event("safe status summary"),
      undefined,
      NOW,
    );
    if (!build.ok) throw new Error("expected ok");
    expect(build.request.body).not.toMatch(/sk-|Bearer|api[_-]?key/i);
  });
});

function feishuSecret(): string {
  return "feishu-secret";
}

describe("D.14E remote transport — official CLI invocation (arg array, no shell)", () => {
  it("feishu builds a discrete argument array without shell metacharacters", () => {
    const build = buildOfficialCliInvocation(
      channel("feishu", { cliPath: "feishu-cli", bindingUserId: "user-1" }),
      event("hi; rm -rf / && echo pwned"),
    );
    if (!build.ok) throw new Error("expected ok");
    expect(build.command).toBe("feishu-cli");
    expect(Array.isArray(build.args)).toBe(true);
    // The untrusted summary is a single discrete arg, never concatenated into a command string.
    expect(build.args).toContain("hi; rm -rf / && echo pwned");
    expect(build.command).not.toContain(";");
    expect(build.command).not.toContain("&&");
  });

  it("dingtalk and wecom build their own arg arrays", () => {
    const ding = buildOfficialCliInvocation(
      channel("dingtalk", { cliPath: "dws", bindingUserId: "u" }),
      event(),
    );
    const wecom = buildOfficialCliInvocation(
      channel("wecom", { cliPath: "wecom-cli", bindingUserId: "u" }),
      event(),
    );
    if (!ding.ok || !wecom.ok) throw new Error("expected ok");
    expect(ding.command).toBe("dws");
    expect(wecom.command).toBe("wecom-cli");
    expect(ding.args[0]).toBe("im");
    expect(wecom.args[0]).toBe("msg");
  });

  it("reports missing cli path / missing binding instead of guessing", () => {
    expect(
      buildOfficialCliInvocation(
        channel("feishu", { cliPath: undefined, bindingUserId: "u" }),
        event(),
      ),
    ).toEqual({
      ok: false,
      reason: "missing_cli_path",
    });
    expect(
      buildOfficialCliInvocation(
        channel("feishu", { cliPath: "feishu-cli", bindingUserId: undefined }),
        event(),
      ),
    ).toEqual({ ok: false, reason: "missing_binding" });
  });
});

describe("D.14E remote transport — delivery distinguishes failure causes", () => {
  const okFetch: RemoteFetch = async () => ({ status: 200, text: async () => '{"errcode":0}' });

  it("webhook 200 + errcode 0 → sent", async () => {
    expect(await deliverWebhook({ url: "https://x", body: "{}" }, okFetch)).toMatchObject({
      status: "sent",
    });
  });

  it("webhook 401/403 → failed (auth)", async () => {
    const authFetch: RemoteFetch = async () => ({ status: 401, text: async () => "" });
    const result = await deliverWebhook({ url: "https://x", body: "{}" }, authFetch);
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("auth");
  });

  it("webhook 500 → failed (platform)", async () => {
    const badFetch: RemoteFetch = async () => ({ status: 500, text: async () => "" });
    const result = await deliverWebhook({ url: "https://x", body: "{}" }, badFetch);
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("platform");
  });

  it("webhook 200 + errcode != 0 → failed (platform errcode)", async () => {
    const errFetch: RemoteFetch = async () => ({
      status: 200,
      text: async () => '{"errcode":9001}',
    });
    const result = await deliverWebhook({ url: "https://x", body: "{}" }, errFetch);
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("9001");
  });

  it("webhook network throw → failed without leaking endpoint/payload", async () => {
    const throwFetch: RemoteFetch = async () => {
      throw new Error("connect ECONNREFUSED https://secret-endpoint/hook?token=abc");
    };
    const result = await deliverWebhook(
      { url: "https://secret-endpoint/hook?token=abc", body: "{}" },
      throwFetch,
    );
    expect(result.status).toBe("failed");
    expect(result.detail).not.toContain("secret-endpoint");
    expect(result.detail).not.toContain("token=abc");
  });

  it("caller abort after response headers cancels the webhook body read", async () => {
    let bodyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      bodyStarted = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const signal = init.signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              bodyStarted();
              signal?.addEventListener("abort", () => {
                controller.error(signal.reason ?? new DOMException("aborted", "AbortError"));
              });
            },
          }),
          { status: 200 },
        );
      }),
    );
    const caller = new AbortController();
    const pending = deliverWebhook(
      { url: "https://secret-endpoint/hook?token=abc", body: "{}" },
      defaultRemoteTransportDeps().fetch,
      caller.signal,
    );
    await started;
    caller.abort();

    await expect(pending).resolves.toEqual({
      status: "failed",
      detail: "remote delivery cancelled",
    });
  });

  it("webhook timeout remains active while reading a stalled response body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const signal = init.signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              signal?.addEventListener("abort", () => {
                controller.error(signal.reason ?? new DOMException("timeout", "AbortError"));
              });
            },
          }),
          { status: 200 },
        );
      }),
    );
    const pending = deliverWebhook(
      { url: "https://secret-endpoint/hook?token=abc", body: "{}" },
      defaultRemoteTransportDeps().fetch,
    );
    await vi.advanceTimersByTimeAsync(8_001);

    const result = await pending;
    expect(result).toEqual({ status: "failed", detail: "network error reaching remote channel" });
    expect(JSON.stringify(result)).not.toContain("secret-endpoint");
    expect(JSON.stringify(result)).not.toContain("token=abc");
  });

  it("official CLI success → sent; ENOENT → blocked; other error → failed", async () => {
    const okRunner: RemoteCliRunner = async () => ({ stdout: "ok", stderr: "" });
    expect(await deliverOfficialCli("feishu-cli", ["im"], okRunner)).toMatchObject({
      status: "sent",
    });

    const missingRunner: RemoteCliRunner = async () => {
      throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    };
    expect(await deliverOfficialCli("missing-cli", ["im"], missingRunner)).toMatchObject({
      status: "blocked",
    });

    const failRunner: RemoteCliRunner = async () => {
      throw Object.assign(new Error("exit 1"), { code: 1 });
    };
    expect(await deliverOfficialCli("feishu-cli", ["im"], failRunner)).toMatchObject({
      status: "failed",
    });
  });

  it("forwards caller abort to official CLI and keeps cancellation recoverable", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const runner: RemoteCliRunner = async (_command, _args, _timeoutMs, signal) => {
      receivedSignal = signal;
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" })),
          { once: true },
        );
      });
      return { stdout: "", stderr: "" };
    };
    const pending = deliverOfficialCli("feishu-cli", ["im"], runner, 10_000, controller.signal);
    controller.abort();

    await expect(pending).resolves.toEqual({
      status: "failed",
      detail: "official CLI delivery cancelled",
    });
    expect(receivedSignal).toBe(controller.signal);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(
      deliverOfficialCli(
        "missing-cli",
        ["im"],
        async () => {
          throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
        },
        10_000,
        alreadyAborted.signal,
      ),
    ).resolves.toEqual({
      status: "failed",
      detail: "official CLI delivery cancelled",
    });
  });

  it("terminates the default official CLI child well before its timeout", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = defaultRemoteTransportDeps().runCli(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      10_000,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 100);

    await expect(pending).rejects.toMatchObject({ code: "ABORT_ERR" });
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });
});
