import type { ToolOutput } from "../../index.js";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_CONTENT_LENGTH = 50_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

export type WebFetchInput = {
  url: string;
  prompt?: string;
};

type WebFetchResult =
  | { ok: true; content: string; status: number; statusText: string; contentType: string | null; size: number }
  | {
      ok: false;
      error: string;
      errorCode: "INVALID_URL" | "HTTP_ERROR" | "ABORTED" | "TIMEOUT" | "REQUEST_ERROR";
      status?: number;
      aborted: boolean;
      timedOut: boolean;
    };

type WebFetchProgress = {
  phase: "connecting" | "receiving" | "processing";
  transport: "http" | "https";
  receivedBytes?: number;
};

export async function webFetch(
  input: WebFetchInput,
  callerSignal?: AbortSignal,
  onProgress?: (progress: WebFetchProgress) => void,
): Promise<WebFetchResult> {
  // 1. Validate URL
  const urlError = validateUrl(input.url);
  if (urlError) {
    return {
      ok: false,
      error: urlError,
      errorCode: "INVALID_URL",
      aborted: false,
      timedOut: false,
    };
  }

  const url = input.url.startsWith("http://") ? input.url : input.url;
  const transport = url.startsWith("http://") ? "http" : "https";

  const controller = new AbortController();
  let abortCause: "caller" | "timeout" | undefined;
  const abortFromCaller = () => {
    abortCause ??= "caller";
    controller.abort(callerSignal?.reason);
  };
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    abortCause ??= "timeout";
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    onProgress?.({ phase: "connecting", transport });
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    const contentType = response.headers.get("content-type") || null;

    // Read body with size limit
    let body = "";
    const reader = response.body?.getReader();
    if (!reader) {
      return {
        ok: false,
        error: "无法读取响应内容",
        errorCode: "REQUEST_ERROR",
        status: response.status,
        aborted: false,
        timedOut: false,
      };
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });
    let totalBytes = 0;
    onProgress?.({ phase: "receiving", transport, receivedBytes: totalBytes });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      onProgress?.({ phase: "receiving", transport, receivedBytes: totalBytes });
      if (totalBytes > MAX_RESPONSE_SIZE) {
        reader.cancel();
        body += decoder.decode(value.slice(0, MAX_RESPONSE_SIZE - (totalBytes - value.length)), {
          stream: true,
        });
        break;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    onProgress?.({ phase: "processing", transport, receivedBytes: totalBytes });

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} ${response.statusText}`,
        errorCode: "HTTP_ERROR",
        status: response.status,
        aborted: false,
        timedOut: false,
      };
    }

    // Convert HTML to text
    const isHtml =
      contentType &&
      (contentType.includes("text/html") || contentType.includes("application/xhtml"));
    const content = isHtml ? htmlToText(body) : body;

    // Truncate
    const trimmed =
      content.length > MAX_CONTENT_LENGTH
        ? content.slice(0, MAX_CONTENT_LENGTH) + "\n\n...（内容已截断）"
        : content;

    return {
      ok: true,
      content: trimmed,
      status: response.status,
      statusText: response.statusText,
      contentType,
      size: totalBytes,
    };
  } catch (error) {
    if (abortCause === "caller") {
      return {
        ok: false,
        error: "请求已中断",
        errorCode: "ABORTED",
        aborted: true,
        timedOut: false,
      };
    }
    if (abortCause === "timeout") {
      return {
        ok: false,
        error: "请求超时",
        errorCode: "TIMEOUT",
        aborted: false,
        timedOut: true,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `请求失败: ${message}`,
      errorCode: "REQUEST_ERROR",
      aborted: false,
      timedOut: false,
    };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

// ---------------------------------------------------------------------------
// URL validation (SSRF guard)
// ---------------------------------------------------------------------------

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "169.254.169.254", // AWS metadata
  "metadata.google.internal", // GCP metadata
]);

const BLOCKED_CIDRS = [
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^fc00:/i,
  /^fd00:/i,
  /^fe80:/i,
];

function validateUrl(raw: string): string | null {
  if (!raw) return "URL 不能为空";
  if (raw.length > 2000) return "URL 过长";

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `无法解析 URL: ${raw}`;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `不支持的协议: ${url.protocol}`;
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(hostname)) return `禁止访问内部地址: ${hostname}`;

  for (const cidr of BLOCKED_CIDRS) {
    if (cidr.test(hostname)) return `禁止访问私有地址: ${hostname}`;
  }

  // Block URLs with embedded credentials
  if (url.username || url.password) return "URL 不能包含凭据";

  return null;
}

// ---------------------------------------------------------------------------
// HTML → text conversion
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
  let text = html;

  // Remove script/style/noscript/template/svg/head elements
  text = text.replace(
    /<(script|style|noscript|template|svg|head|nav|footer|iframe|canvas|video|audio)\b[\s\S]*?<\/\1>/gi,
    "",
  );
  text = text.replace(/<(script|style|noscript|template|svg|head|nav|footer|iframe)\b[^>]*\/>/gi, "");

  // Remove comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Convert block elements to newlines (before tag stripping)
  text = text.replace(/<\/(div|p|h[1-6]|li|tr|article|section|header|footer|aside|main|pre|blockquote|table|ul|ol|dl|hr|br)[^>]*>/gi, "\n");
  text = text.replace(/<(br|hr)\b[^>]*\/?>/gi, "\n");

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

  // Collapse whitespace
  text = text
    .split(/\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");

  // Remove excessive blank lines
  text = text.replace(/\n{4,}/g, "\n\n\n");

  return text.trim();
}

// ---------------------------------------------------------------------------
// ToolOutput formatting
// ---------------------------------------------------------------------------

export function formatFetchOutput(
  url: string,
  result: WebFetchResult,
  durationMs: number,
): ToolOutput {
  if (!result.ok) {
    return {
      text: `WebFetch failed for "${url}": ${result.error}`,
      data: {
        url,
        status: result.status ?? 0,
        statusText: result.error,
        size: 0,
        durationMs,
        isError: true,
        error: result.error,
        errorCode: result.errorCode,
        aborted: result.aborted,
        timedOut: result.timedOut,
      },
    };
  }

  const kb = result.size >= 1024 ? `${(result.size / 1024).toFixed(1)}KB` : `${result.size}B`;
  const preview = result.content.length > 500 ? result.content.slice(0, 500) + "..." : result.content;

  return {
    text: `WebFetch result for "${url}" (${kb}, HTTP ${result.status}):\n\n${result.content}`,
    preview,
    data: {
      url,
      status: result.status,
      statusText: result.statusText,
      contentLength: result.size,
      size: result.size,
      contentType: result.contentType,
      durationMs,
      content: result.content,
    },
  };
}
