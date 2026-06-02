import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CacheFreshness } from "@linghun/core";
import { diffFreshness } from "./cache-freshness.js";
import type { TuiContext } from "./index.js";

type BreakCacheMode = "off" | "once" | "always";
type BreakCacheMarker = { mode: BreakCacheMode; nonce?: string };
type BreakCacheEvent = { action: string; createdAt: string };

const BREAK_CACHE_ONCE_FILENAME = ".break-cache-once";
const BREAK_CACHE_ALWAYS_FILENAME = ".break-cache-always";
const BREAK_CACHE_EVENTS_FILENAME = "break-cache-events.jsonl";
const BREAK_CACHE_EVENTS_MAX_LINES = 200;
const BREAK_CACHE_EVENTS_TRIM_BATCH = 25;
const breakCacheEventLineCounts = new Map<string, number>();

function getBreakCacheDir(context: TuiContext): string {
  return join(context.projectPath, ".linghun");
}

function getBreakCacheOncePath(context: TuiContext): string {
  return join(getBreakCacheDir(context), BREAK_CACHE_ONCE_FILENAME);
}

function getBreakCacheAlwaysPath(context: TuiContext): string {
  return join(getBreakCacheDir(context), BREAK_CACHE_ALWAYS_FILENAME);
}

function getBreakCacheEventsPath(context: TuiContext): string {
  return join(getBreakCacheDir(context), BREAK_CACHE_EVENTS_FILENAME);
}

function readBreakCacheMarkerSync(context: TuiContext): BreakCacheMarker {
  // always 优先于 once；off 表示无 marker。任何读取错误一律视为 off。
  try {
    const alwaysPath = getBreakCacheAlwaysPath(context);
    if (existsSync(alwaysPath)) {
      const nonce = readFileSync(alwaysPath, "utf8").trim();
      return { mode: "always", nonce: nonce || undefined };
    }
    const oncePath = getBreakCacheOncePath(context);
    if (existsSync(oncePath)) {
      const nonce = readFileSync(oncePath, "utf8").trim();
      return { mode: "once", nonce: nonce || undefined };
    }
  } catch {
    // 静默降级到 off；marker 不可读不应阻断主流程。
  }
  return { mode: "off" };
}

function readRecentBreakCacheEventsSync(context: TuiContext, limit: number): BreakCacheEvent[] {
  try {
    const path = getBreakCacheEventsPath(context);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
    const recent = lines.slice(-Math.max(1, limit));
    const events: BreakCacheEvent[] = [];
    for (const line of recent) {
      try {
        const parsed = JSON.parse(line) as Partial<BreakCacheEvent>;
        if (typeof parsed.action === "string" && typeof parsed.createdAt === "string") {
          events.push({ action: parsed.action, createdAt: parsed.createdAt });
        }
      } catch {
        // 跳过损坏行，不抛
      }
    }
    return events;
  } catch {
    return [];
  }
}

export async function appendBreakCacheEvent(context: TuiContext, action: string): Promise<void> {
  // 有界 jsonl：缓存当前进程写入的行数；只有超过上限时才读取并截断，避免高频事件反复重写整文件。
  try {
    await mkdir(getBreakCacheDir(context), { recursive: true });
    const path = getBreakCacheEventsPath(context);
    const currentCount = await getBreakCacheEventLineCount(path);
    const event: BreakCacheEvent = { action, createdAt: new Date().toISOString() };
    await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
    breakCacheEventLineCounts.set(path, currentCount + 1);
    await truncateBreakCacheEventsIfNeeded(path);
  } catch {
    // ignore
  }
}

async function getBreakCacheEventLineCount(path: string): Promise<number> {
  const cached = breakCacheEventLineCounts.get(path);
  if (typeof cached === "number") {
    return cached;
  }
  const raw = await readFile(path, "utf8").catch(() => "");
  const count = raw.split(/\r?\n/).filter((line) => line.length > 0).length;
  breakCacheEventLineCounts.set(path, count);
  return count;
}

async function truncateBreakCacheEventsIfNeeded(path: string): Promise<void> {
  const currentCount = breakCacheEventLineCounts.get(path) ?? 0;
  if (currentCount < BREAK_CACHE_EVENTS_MAX_LINES + BREAK_CACHE_EVENTS_TRIM_BATCH) {
    return;
  }
  const raw = await readFile(path, "utf8").catch(() => "");
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length <= BREAK_CACHE_EVENTS_MAX_LINES) {
    breakCacheEventLineCounts.set(path, lines.length);
    return;
  }
  const trimmed = lines.slice(-BREAK_CACHE_EVENTS_MAX_LINES).join("\n");
  await writeFile(path, `${trimmed}\n`, "utf8");
  breakCacheEventLineCounts.set(path, BREAK_CACHE_EVENTS_MAX_LINES);
}

export async function writeBreakCacheMarker(
  context: TuiContext,
  mode: "once" | "always",
  nonce: string,
): Promise<void> {
  await mkdir(getBreakCacheDir(context), { recursive: true });
  const path = mode === "once" ? getBreakCacheOncePath(context) : getBreakCacheAlwaysPath(context);
  await writeFile(path, nonce, "utf8");
}

export async function clearBreakCacheMarker(
  context: TuiContext,
  mode: BreakCacheMode | "all",
): Promise<void> {
  const targets: string[] = [];
  if (mode === "once" || mode === "all") targets.push(getBreakCacheOncePath(context));
  if (mode === "always" || mode === "all") targets.push(getBreakCacheAlwaysPath(context));
  for (const target of targets) {
    try {
      if (existsSync(target)) {
        await rm(target, { force: true });
      }
    } catch {
      // ignore；下次状态读取仍能反映真实文件状态
    }
  }
}

// D.13F：导出 path-based pure helper 仅供 model-doctor / break-cache 单元测试使用。
// 不依赖 TuiContext，避免测试构造庞大的运行时上下文。生产代码继续使用 context-based 形态。
export type BreakCacheTestHooks = {
  writeMarker: (projectPath: string, mode: "once" | "always", nonce: string) => Promise<void>;
  clearMarker: (projectPath: string, mode: "off" | "once" | "always" | "all") => Promise<void>;
  readMarker: (projectPath: string) => { mode: "off" | "once" | "always"; nonce?: string };
  consumeNonce: (projectPath: string) => Promise<string | undefined>;
  appendEvent: (projectPath: string, action: string) => Promise<void>;
  readRecentEvents: (
    projectPath: string,
    limit: number,
  ) => Array<{ action: string; createdAt: string }>;
  buildPromptCacheFields: (
    projectPath: string,
    enabled: boolean,
    systemTtl: "5m" | "1h",
  ) => Promise<{
    promptCacheEnabled?: boolean;
    promptCacheTtl?: "1h";
    cacheBreakNonce?: string;
  }>;
  paths: (projectPath: string) => {
    onceMarker: string;
    alwaysMarker: string;
    eventsLog: string;
  };
  eventsMaxLines: number;
};

function makeFakeContextForPath(projectPath: string): TuiContext {
  // 单元测试专用：仅提供 break-cache 助手所需的 projectPath 字段。
  // 其它字段访问会抛 TypeError，迫使新依赖在测试覆盖中显式增加。
  return { projectPath } as unknown as TuiContext;
}

export const breakCacheTestHooks: BreakCacheTestHooks = {
  writeMarker: (projectPath, mode, nonce) =>
    writeBreakCacheMarker(makeFakeContextForPath(projectPath), mode, nonce),
  clearMarker: (projectPath, mode) =>
    clearBreakCacheMarker(makeFakeContextForPath(projectPath), mode),
  readMarker: (projectPath) => readBreakCacheMarkerSync(makeFakeContextForPath(projectPath)),
  consumeNonce: (projectPath) =>
    consumeBreakCacheNonceForRequest(makeFakeContextForPath(projectPath)),
  appendEvent: (projectPath, action) =>
    appendBreakCacheEvent(makeFakeContextForPath(projectPath), action),
  readRecentEvents: (projectPath, limit) =>
    readRecentBreakCacheEventsSync(makeFakeContextForPath(projectPath), limit),
  buildPromptCacheFields: async (projectPath, enabled, systemTtl) => {
    if (!enabled) return {};
    const nonce = await consumeBreakCacheNonceForRequest(makeFakeContextForPath(projectPath));
    return {
      promptCacheEnabled: true,
      ...(systemTtl === "1h" ? { promptCacheTtl: "1h" as const } : {}),
      ...(nonce ? { cacheBreakNonce: nonce } : {}),
    };
  },
  paths: (projectPath) => {
    const ctx = makeFakeContextForPath(projectPath);
    return {
      onceMarker: getBreakCacheOncePath(ctx),
      alwaysMarker: getBreakCacheAlwaysPath(ctx),
      eventsLog: getBreakCacheEventsPath(ctx),
    };
  },
  eventsMaxLines: BREAK_CACHE_EVENTS_MAX_LINES,
};

// 由请求 dispatch 路径调用：返回当轮要写进 ModelRequest 的 cacheBreakNonce，
// 并在 once 命中后立即消费 marker（删除 once 文件）。always 不消费。
async function consumeBreakCacheNonceForRequest(context: TuiContext): Promise<string | undefined> {
  const marker = readBreakCacheMarkerSync(context);
  if (marker.mode === "off") return undefined;
  const nonce = marker.nonce && marker.nonce.length > 0 ? marker.nonce : randomUUID();
  if (marker.mode === "once") {
    try {
      await rm(getBreakCacheOncePath(context), { force: true });
    } catch {
      // ignore
    }
    await appendBreakCacheEvent(context, "once_consumed");
  }
  return nonce;
}

// D.13F：把 promptCache 配置 + 当轮 nonce 折叠成 ModelRequest 片段。
// enabled=false 时返回空对象，请求体不会带 cache_control / nonce。
export async function buildPromptCacheRequestFields(context: TuiContext): Promise<{
  promptCacheEnabled?: boolean;
  promptCacheTtl?: "1h";
  cacheBreakNonce?: string;
}> {
  const config = context.config.promptCache;
  if (!config.enabled) return {};
  const nonce = await consumeBreakCacheNonceForRequest(context);
  return {
    promptCacheEnabled: true,
    ...(config.systemTtl === "1h" ? { promptCacheTtl: "1h" as const } : {}),
    ...(nonce ? { cacheBreakNonce: nonce } : {}),
  };
}

// D.14A-2：freshness 计算（getCurrentFreshness）留在 index.ts（强依赖大子树），
// 由调用方传入当轮 CacheFreshness，本格式化器保持纯展示。
export function formatBreakCacheStatus(context: TuiContext, current: CacheFreshness): string {
  const changed = diffFreshness(context.cache.lastFreshness, current);
  const keys =
    changed.length > 0
      ? changed
      : context.cache.lastFreshness?.changedKeys.length
        ? context.cache.lastFreshness.changedKeys
        : (context.cache.history.at(-1)?.freshness.changedKeys ?? []);
  // D.13F：standalone marker mode 与最近事件摘要，仅作只读展示。
  const marker = readBreakCacheMarkerSync(context);
  const recentEvents = readRecentBreakCacheEventsSync(context, 3);
  return [
    "Break-cache status",
    `- systemPromptHash: ${current.systemPromptHash}`,
    `- toolSchemaHash: ${current.toolSchemaHash}`,
    `- mcpToolListHash: ${current.mcpToolListHash}`,
    `- modelProviderHash: ${current.modelProviderHash}`,
    `- reasoningEffortHash: ${current.reasoningEffortHash ?? "-"}`,
    `- projectRulesHash: ${current.projectRulesHash ?? "-"}`,
    `- memoryHash: ${current.memoryHash ?? "-"}`,
    `- compactHash: ${current.compactHash ?? "-"}`,
    `- pluginListHash: ${current.pluginListHash ?? "-"}`,
    `- endpointProfileHash: ${current.endpointProfileHash ?? "-"}`,
    `- cacheControlHash: ${current.cacheControlHash ?? "-"}`,
    `- cacheTtlHash: ${current.cacheTtlHash ?? "-"}`,
    `- promptCache: enabled=${context.config.promptCache.enabled ? "yes" : "no"} systemTtl=${context.config.promptCache.systemTtl}`,
    `- mode: ${marker.mode}${marker.nonce ? ` nonce=${marker.nonce.slice(0, 8)}…` : ""}${marker.mode === "always" ? "（固定 break-cache namespace；不会每次请求都破坏缓存）" : ""}`,
    `- recent break-cache events: ${recentEvents.length === 0 ? "none" : recentEvents.map((event) => `${event.action}@${event.createdAt}`).join("; ")}`,
    `- changedKeys: ${keys.length > 0 ? keys.join(", ") : "none"}`,
    "- usage: /break-cache status | once | always | off | --clear；marker 与 event 仅记录动作，不记录 prompt/key/raw request/response。always=固定 nonce 切到新 cache namespace（stable nonce），不是每次请求都破坏缓存。",
    "- suggestion: 如 system prompt / tool schema / MCP list / model/provider / memory / compact / plugin list / endpoint profile / cacheControl / cacheTtl 变化，可运行 /cache warmup 或 /cache refresh；不会替你自动执行。",
  ].join("\n");
}
