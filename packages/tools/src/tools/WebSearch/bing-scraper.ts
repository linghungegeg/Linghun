import type { ToolOutput } from "../../index.js";

const BING_URL = "https://cn.bing.com/search";
const TIMEOUT_MS = 20_000;
const MAX_RESULTS_DEFAULT = 8;

export type WebSearchInput = {
  query: string;
  num_results?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
};

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type BingScrapeResult =
  | { ok: true; results: SearchResult[] }
  | { ok: false; error: string; status?: number };

/**
 * Scrape Bing (cn.bing.com) HTML search results.
 * Zero API key, zero cost, accessible from mainland China.
 */
export async function bingSearch(input: WebSearchInput): Promise<BingScrapeResult> {
  const query = input.query.trim();
  if (!query) return { ok: false, error: "搜索词不能为空" };

  const count = Math.min(input.num_results ?? MAX_RESULTS_DEFAULT, 20);
  const searchUrl = `${BING_URL}?q=${encodeURIComponent(query)}&count=${count}&setlang=zh-cn`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return {
        ok: false,
        error: `Bing 返回 HTTP ${response.status}`,
        status: response.status,
      };
    }

    const html = await response.text();
    const results = parseBingHtml(html, count);
    return { ok: true, results };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: "搜索超时" };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `搜索请求失败: ${message}` };
  }
}

function parseBingHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // cn.bing.com places organic results inside <li class="b_algo">
  const blockRegex = /<li\s[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  const matches = html.matchAll(blockRegex);

  for (const match of matches) {
    if (results.length >= maxResults) break;
    const block = match[1];

    // Extract title from <h2><a href="...">title</a></h2>
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    const rawUrl = titleMatch[1];
    const title = stripHtml(titleMatch[2]).trim();
    if (!title) continue;

    // Resolve Bing redirect URLs
    const url = resolveBingUrl(rawUrl);

    // Extract snippet — try multiple Bing layout patterns
    let snippet = "";
    const captionMatch = block.match(/<div\s[^>]*class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (captionMatch) {
      snippet = stripHtml(captionMatch[1]).trim();
    }
    if (!snippet) {
      // Fallback: any paragraph
      const pMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      if (pMatch) snippet = stripHtml(pMatch[1]).trim();
    }

    results.push({ title, url, snippet });
  }

  return results;
}

/** Resolve Bing redirect URLs like /ck/a?...&u=a1aHR0c... → real URL */
function resolveBingUrl(raw: string): string {
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  // Bing uses /ck/a?...&u=<base64url> for redirect tracking
  const uMatch = raw.match(/[?&]u=([^&]+)/i);
  if (uMatch) {
    try {
      const decoded = Buffer.from(uMatch[1], "base64url").toString("utf-8");
      if (decoded.startsWith("http://") || decoded.startsWith("https://")) return decoded;
    } catch {
      // base64 decode failed, fall through
    }
  }

  // Relative URL → prepend bing domain
  if (raw.startsWith("/")) return `https://cn.bing.com${raw}`;

  return raw;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

/** Format search results as a ToolOutput for the model and UI. */
export function formatSearchOutput(
  query: string,
  results: SearchResult[],
  durationMs: number,
): ToolOutput {
  if (results.length === 0) {
    return {
      text: `No web search results found for: "${query}"`,
      data: {
        query,
        results: [],
        searches: 1,
        count: 0,
        duration: durationMs / 1000,
        durationMs,
      },
    };
  }

  const lines: string[] = [];
  lines.push(`Web search results for query: "${query}"`);
  lines.push("");
  lines.push("Links:");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const title = r.title;
    const url = r.url;
    const snippet = r.snippet ? `: ${r.snippet.slice(0, 200)}` : "";
    lines.push(`  ${i + 1}. [${title}](${url})${snippet}`);
  }
  lines.push("");
  lines.push(
    "REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.",
  );

  return {
    text: lines.join("\n"),
    data: {
      query,
      results,
      searches: 1,
      count: results.length,
      duration: durationMs / 1000,
      durationMs,
    },
  };
}

export function applyDomainFilter(
  results: SearchResult[],
  allowed_domains?: string[],
  blocked_domains?: string[],
): SearchResult[] {
  if (allowed_domains && allowed_domains.length > 0) {
    const allowed = new Set(allowed_domains.map((d) => d.toLowerCase()));
    return results.filter((r) => {
      try {
        const host = new URL(r.url).hostname.toLowerCase();
        return allowed.has(host) || allowed.has(host.replace(/^www\./, ""));
      } catch {
        return false;
      }
    });
  }

  if (blocked_domains && blocked_domains.length > 0) {
    const blocked = new Set(blocked_domains.map((d) => d.toLowerCase()));
    return results.filter((r) => {
      try {
        const host = new URL(r.url).hostname.toLowerCase();
        return !blocked.has(host) && !blocked.has(host.replace(/^www\./, ""));
      } catch {
        return true; // can't parse → don't block
      }
    });
  }

  return results;
}
