import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CacheFreshness } from "@linghun/core";
import { formatDiagnosticError, isNodeErrorWithCode } from "@linghun/shared";
import {
  diagnoseCacheBreak,
  formatCacheBreakDiagnosis,
} from "./cache-break-diagnostics-runtime.js";
import { diffFreshness } from "./cache-freshness.js";
import type { TuiContext } from "./index.js";

type BreakCacheMode = "off" | "once" | "always";
type BreakCacheMarker = { mode: BreakCacheMode; nonce?: string };
type BreakCacheEvent = { action: string; createdAt: string };

const BREAK_CACHE_ONCE_FILENAME = ".break-cache-once";
const BREAK_CACHE_ALWAYS_FILENAME = ".break-cache-always";
const BREAK_CACHE_EVENTS_FILENAME = "break-cache-events.jsonl";

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
  } catch (error) {
    logBreakCacheWarning(context, `read_marker_failed reason=${formatDiagnosticError(error)}`);
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
      } catch (error) {
        logBreakCacheWarning(
          context,
          `read_events_parse_failed reason=${formatDiagnosticError(error)}`,
        );
      }
    }
    return events;
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      logBreakCacheWarning(context, `read_events_failed reason=${formatDiagnosticError(error)}`);
    }
    return [];
  }
}

export async function appendBreakCacheEvent(context: TuiContext, action: string): Promise<void> {
  try {
    await mkdir(getBreakCacheDir(context), { recursive: true });
    const path = getBreakCacheEventsPath(context);
    const event: BreakCacheEvent = { action, createdAt: new Date().toISOString() };
    await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    await appendRuntimeWarning(
      context,
      `break_cache_event_write_failed reason=${formatDiagnosticError(error)}`,
    );
  }
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
    } catch (error) {
      await appendRuntimeWarning(
        context,
        `break_cache_marker_clear_failed path=${target} reason=${formatDiagnosticError(error)}`,
      );
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
    } catch (error) {
      await appendRuntimeWarning(
        context,
        `break_cache_once_consume_failed reason=${formatDiagnosticError(error)}`,
      );
    }
    await appendBreakCacheEvent(context, "once_consumed");
  }
  return nonce;
}

function logBreakCacheWarning(context: TuiContext, message: string): void {
  process.stderr.write(`[linghun] break_cache_warning project=${context.projectPath} ${message}\n`);
}

async function appendRuntimeWarning(context: TuiContext, message: string): Promise<void> {
  if (!context.sessionId) {
    logBreakCacheWarning(context, message);
    return;
  }
  try {
    await context.store.appendEvent(context.sessionId, {
      type: "system_event",
      id: randomUUID(),
      level: "warning",
      message,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    logBreakCacheWarning(
      context,
      `${message}; warning_write_failed=${formatDiagnosticError(error)}`,
    );
  }
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
  const diagnosis = diagnoseCacheBreak({
    latest: context.cache.history.at(-1),
    observation: context.cache.lastRequestObservation,
    freshnessChangedKeys: keys,
    warnBelowHitRate: context.cache.config.warnBelowHitRate,
  });
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
    `- prompt cache: enabled ${context.config.promptCache.enabled ? "yes" : "no"}; system ttl ${context.config.promptCache.systemTtl}`,
    `- mode: ${marker.mode}${marker.nonce ? `; nonce ${marker.nonce.slice(0, 8)}…` : ""}${marker.mode === "always" ? "（固定 break-cache namespace；不会每次请求都破坏缓存）" : ""}`,
    `- recent break-cache events: ${recentEvents.length === 0 ? "none" : recentEvents.map((event) => `${event.action}@${event.createdAt}`).join("; ")}`,
    `- changed keys: ${keys.length > 0 ? keys.join(", ") : "none"}`,
    `- diagnosis: ${formatCacheBreakDiagnosis(diagnosis)}`,
    "- usage: /break-cache status | once | always | off | --clear；marker 与 event 仅记录动作，不记录 prompt/key/raw request/response。always=固定 nonce 切到新 cache namespace（stable nonce），不是每次请求都破坏缓存。",
    "- suggestion: 如 system prompt / tool schema / MCP list / model/provider / memory / compact / plugin list / endpoint profile / cacheControl / cacheTtl 变化，可运行 /cache warmup 或 /cache refresh；不会替你自动执行。",
  ].join("\n");
}
