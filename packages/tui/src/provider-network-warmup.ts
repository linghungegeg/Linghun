import { lookup as defaultLookup } from "node:dns/promises";
import type { LinghunConfig } from "@linghun/config";

export type ProviderDnsLookup = (hostname: string) => Promise<unknown>;

const warmedProviderHosts = new Set<string>();

export function shouldWarmProviderDnsForStreams(
  input: unknown,
  output: unknown,
): boolean {
  return readIsTty(input) && readIsTty(output);
}

function readIsTty(stream: unknown): boolean {
  return (
    typeof stream === "object" &&
    stream !== null &&
    (stream as { isTTY?: unknown }).isTTY === true
  );
}

export function warmConfiguredProviderDns(
  config: LinghunConfig,
  options: {
    lookup?: ProviderDnsLookup;
    warmedHosts?: Set<string>;
  } = {},
): string[] {
  const lookup = options.lookup ?? defaultLookup;
  const warmedHosts = options.warmedHosts ?? warmedProviderHosts;
  const scheduled: string[] = [];

  for (const provider of Object.values(config.providers)) {
    const hostname = readWarmableProviderHostname(provider.baseUrl);
    if (!hostname || warmedHosts.has(hostname)) continue;
    warmedHosts.add(hostname);
    scheduled.push(hostname);
    void lookup(hostname).catch(() => {
      // Best-effort DNS warmup only; provider request errors remain on the real fetch path.
    });
  }

  return scheduled;
}

export function readWarmableProviderHostname(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
