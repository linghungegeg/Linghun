import { defaultConfig } from "@linghun/config";
import { describe, expect, it, vi } from "vitest";
import {
  readWarmableProviderHostname,
  shouldWarmProviderDnsForStreams,
  warmConfiguredProviderDns,
} from "./provider-network-warmup.js";

describe("provider network warmup", () => {
  it("only enables startup warmup for real interactive TTY streams", () => {
    expect(shouldWarmProviderDnsForStreams({ isTTY: true }, { isTTY: true })).toBe(true);
    expect(shouldWarmProviderDnsForStreams({ isTTY: true }, { isTTY: false })).toBe(false);
    expect(shouldWarmProviderDnsForStreams({ isTTY: false }, { isTTY: true })).toBe(false);
    expect(shouldWarmProviderDnsForStreams({}, { isTTY: true })).toBe(false);
  });

  it("extracts only HTTP provider hostnames", () => {
    expect(readWarmableProviderHostname("https://Example.COM/v1")).toBe("example.com");
    expect(readWarmableProviderHostname("http://relay.local:8080/api")).toBe("relay.local");
    expect(readWarmableProviderHostname("file:///tmp/provider")).toBeUndefined();
    expect(readWarmableProviderHostname("not a url")).toBeUndefined();
    expect(readWarmableProviderHostname(undefined)).toBeUndefined();
  });

  it("schedules one best-effort DNS lookup per configured provider host", () => {
    const lookup = vi.fn(async () => undefined);
    const warmedHosts = new Set<string>();
    const config = {
      ...defaultConfig,
      providers: {
        a: {
          type: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          model: "model-a",
        },
        b: {
          type: "openai-compatible",
          baseUrl: "https://api.example.com/responses",
          model: "model-b",
        },
        c: {
          type: "deepseek",
          baseUrl: "https://deepseek.example.com",
          model: "model-c",
        },
        ignored: {
          type: "openai-compatible",
          baseUrl: "not a url",
          model: "model-d",
        },
      },
    } satisfies typeof defaultConfig;

    expect(warmConfiguredProviderDns(config, { lookup, warmedHosts })).toEqual([
      "api.example.com",
      "deepseek.example.com",
    ]);
    expect(warmConfiguredProviderDns(config, { lookup, warmedHosts })).toEqual([]);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenNthCalledWith(1, "api.example.com");
    expect(lookup).toHaveBeenNthCalledWith(2, "deepseek.example.com");
  });

  it("swallows warmup lookup failures because fetch remains authoritative", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("dns failed");
    });

    expect(
      warmConfiguredProviderDns(
        {
          ...defaultConfig,
          providers: {
            broken: {
              type: "openai-compatible",
              baseUrl: "https://broken.example.com/v1",
              model: "model",
            },
          },
        },
        { lookup, warmedHosts: new Set() },
      ),
    ).toEqual(["broken.example.com"]);
    await Promise.resolve();
    expect(lookup).toHaveBeenCalledWith("broken.example.com");
  });
});
