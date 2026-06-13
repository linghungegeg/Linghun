// D.14D-R2 P2-1 — provider stream / eventstream CRC mismatch attribution.
//
// 验证 provider 传输层失败（CRC mismatch / stream decode / retry exhausted）被
// 归类并展示为 provider/transit failure，而不是套上 Linghun runtime bug 文案。
// 不触及真实 provider route；只检查 user-facing 归因文案与脱敏。

import { describe, expect, it } from "vitest";
import { formatProviderFailurePrimary } from "./request-lifecycle-presenter.js";

function err(message: string, code?: string): Error {
  const e = new Error(message);
  if (code) Object.assign(e, { code });
  return e;
}

describe("D.14D-R2 P2-1 provider transit failure attribution", () => {
  it("eventstream CRC mismatch is attributed to provider/transit, not a Linghun bug (en)", () => {
    const text = formatProviderFailurePrimary(
      err("Anthropic Messages stream decode failed: eventstream CRC mismatch"),
      "en-US",
    );
    expect(text).toContain("service or network transport issue");
    expect(text).toContain("not a local Linghun bug");
    // 不退化成通用 runtime 文案。
    expect(text).not.toBe(
      "The model request did not complete. Run /model doctor for details, then retry.",
    );
  });

  it("CRC mismatch 归因 provider/传输，不是 Linghun 缺陷 (zh)", () => {
    const text = formatProviderFailurePrimary(
      err("流解码失败：eventstream CRC 校验不一致"),
      "zh-CN",
    );
    expect(text).toContain("模型服务、网关传输或本地兼容层问题");
    expect(text).not.toBe("模型请求未完成。可运行 /model doctor 查看详情后重试。");
  });

  it("PROVIDER_STREAM_DECODE_ERROR / PROVIDER_RETRY_EXHAUSTED codes classify as transit", () => {
    const decode = formatProviderFailurePrimary(
      err("boom", "PROVIDER_STREAM_DECODE_ERROR"),
      "en-US",
    );
    const retry = formatProviderFailurePrimary(err("boom", "PROVIDER_RETRY_EXHAUSTED"), "en-US");
    expect(decode).toContain("transport issue");
    expect(retry).toContain("transport issue");
  });

  it("PROVIDER_STREAM_ERROR is classified by its inner provider error text", () => {
    const quota = formatProviderFailurePrimary(
      err("quota exceeded", "PROVIDER_STREAM_ERROR"),
      "zh-CN",
    );
    const gateway = formatProviderFailurePrimary(
      err(
        "An error occurred while processing your request. You can retry your request.",
        "PROVIDER_STREAM_ERROR",
      ),
      "zh-CN",
    );
    expect(quota).toContain("额度");
    expect(gateway).toContain("网关");
  });

  it("does not leak baseUrl / api key / raw response in the attribution", () => {
    const text = formatProviderFailurePrimary(
      err("stream decode error from https://api.example.com sk-secret123 api_key=private"),
      "en-US",
    );
    expect(text).not.toContain("sk-secret123");
    expect(text).not.toContain("api_key=private");
    expect(text).not.toContain("api.example.com");
  });
});
