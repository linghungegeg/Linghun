// D.14B Failure Learning Runtime
//
// 从真实失败事件中提取可复用教训，并在后续相似任务中提醒模型避免重复错误。
// 这不是"模型自我反思小作文"系统：所有 learning 必须可追溯到具体失败事件
// （evidence / tool_result / verification / provider error / git operation /
// final gate downgrade / report guard / resource cap），不允许模型凭空总结。
//
// 安全边界（集中脱敏）：
//   - 绝不持久化 secret/apiKey/baseUrl/token/Authorization/完整 env/长绝对路径/隐私正文。
//   - 写入前统一经 sanitizeFailureText 脱敏。
//   - 去重 hash 基于脱敏后的 category + source/target + 归一化 message。
//
// 与 prompt / final-answer gate 的边界：
//   - FailureLearningSummary 只进 system prompt 当风险提示，绝不进 context.evidence，
//     因此不会被任何 D.13U/D.13V supporter 当作 completion evidence。
//   - summary 文案约束模型：把它当历史风险提示，不得据此声称已修复/已验证/已完成。
//
// 业务逻辑全在本模块；index.ts 只做薄接线（在已判定失败的站点搭车记录一行）。

import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { join } from "node:path";
import { type LinghunConfig, resolveStoragePaths } from "@linghun/config";
import { stableHash } from "./cache-freshness.js";
import {
  atomicWriteMemoryFile,
  recoverMemoryReplacementArtifacts,
  withMemoryDirectoryLock,
} from "./memory-extraction-runtime.js";
import { formatError } from "./startup-runtime.js";
import type {
  FailureLearningCategory,
  FailureLearningRecord,
  FailureLearningSeverity,
  FailureLearningState,
  FailureLearningStatus,
} from "./tui-data-types.js";

const MAX_FAILURE_RECORDS = 100;
const FAILURE_SUMMARY_WIDTH = 200;
const AVOID_WIDTH = 160;
const ROOT_CAUSE_WIDTH = 160;
const TARGET_WIDTH = 80;
const PROMPT_TOP_K = 5;
const PROMPT_ITEM_WIDTH = 160;
const PROMPT_TOTAL_WIDTH = 900;

// 脱敏：先剥离 secret/token/key/Authorization/baseUrl/绝对路径，再归一化空白。
// 复用 provider 失败脱敏的成熟范式，并扩展 http(s) baseUrl 与 Windows/Unix 绝对路径。
export function sanitizeFailureText(text: string): string {
  if (!text) return "";
  return text
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***")
    .replace(/(?:gh[pousr])_[A-Za-z0-9]{20,}/gu, "ghx-***")
    .replace(/(?:AKIA|ASIA)[A-Z0-9]{16}/gu, "AKIA-***")
    .replace(/xox[bpras]-[A-Za-z0-9-]+/gu, "xox-***")
    .replace(
      /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END[^-]*-----/gu,
      "[private-key]",
    )
    .replace(/(?:Authorization|authorization)\s*[:=]\s*[^\s,;]+/gu, "Authorization=***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/giu, "Bearer ***")
    .replace(
      /\b(api[_-]?key|token|secret|password|credential|access[_-]?key)\b\s*[:=]\s*[^\s,;]+/giu,
      "$1=***",
    )
    .replace(/https?:\/\/[^\s"'<>]+/giu, "[url]")
    .replace(/[A-Za-z]:[\\/][^\s"'<>]+/gu, "[local-path]")
    .replace(/(?:\/[^\s"'<>/]+){2,}/gu, "[local-path]")
    .replace(/\s+/gu, " ")
    .trim();
}

// 关联目标脱敏：命令/工具/provider/git 操作。命令只保留可执行名首词，不暴露完整路径/参数。
export function sanitizeRelatedTarget(target: string | undefined): string | undefined {
  if (!target) return undefined;
  const cleaned = sanitizeFailureText(target);
  if (!cleaned) return undefined;
  return cleaned.slice(0, TARGET_WIDTH);
}

function clamp(text: string, width: number): string {
  const sanitized = sanitizeFailureText(text);
  return sanitized.length > width ? `${sanitized.slice(0, width - 1)}…` : sanitized;
}

// 项目作用域键：脱敏后的项目目录名，不含完整绝对路径。
export function resolveFailureProjectScope(projectPath: string): string {
  const base = basename(projectPath || "").trim();
  return base ? sanitizeFailureText(base).slice(0, 80) || "project" : "project";
}

function resolveFailureProjectScopeFromDirectory(directory: string, projectPath: string): string {
  if (!process.env.LINGHUN_DATA_DIR) {
    return resolveFailureProjectScope(projectPath);
  }
  const namespace = basename(dirname(directory)).trim();
  return namespace || "project";
}

export function getFailureLearningDirectory(projectPath: string, config?: LinghunConfig): string {
  return resolveStoragePaths(config, projectPath).failures;
}

// 去重 hash：脱敏后的 category + source/target + 归一化 message（小写、压空白、去数字串）。
// 不含 secret/baseUrl/绝对路径（输入已脱敏）；同一类失败的瞬时差异（行号/时间戳）被归一化掉。
export function failureDedupeHash(input: {
  category: FailureLearningCategory;
  relatedTarget?: string;
  failureSummary: string;
  projectScope: string;
}): string {
  const normalizedMessage = sanitizeFailureText(input.failureSummary)
    .toLowerCase()
    .replace(/\b\d[\d.:_-]*\b/gu, "#")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
  return stableHash({
    scope: input.projectScope,
    category: input.category,
    target: sanitizeRelatedTarget(input.relatedTarget) ?? "",
    message: normalizedMessage,
  });
}

export type FailureLearningInput = {
  category: FailureLearningCategory;
  failureSummary: string;
  rootCauseGuess: string;
  avoidNextTime: string;
  sourceRef: string;
  relatedTarget?: string;
  severity?: FailureLearningSeverity;
};

export type FailureLearningCommitResult =
  | { status: "committed"; record: FailureLearningRecord; records: FailureLearningRecord[] }
  | { status: "stale" };

export function createFailureLearningState(
  projectPath: string,
  config?: LinghunConfig,
): FailureLearningState {
  const directory = getFailureLearningDirectory(projectPath, config);
  return {
    directory,
    projectScope: resolveFailureProjectScopeFromDirectory(directory, projectPath),
    records: [],
    degradedWarnings: [],
  };
}

// 构造脱敏后的记录（纯函数，不落库）。rootCauseGuess 强制 inferred=true。
export function buildFailureRecord(
  state: FailureLearningState,
  input: FailureLearningInput,
  now: Date = new Date(),
): FailureLearningRecord {
  const iso = now.toISOString();
  const failureSummary = clamp(input.failureSummary, FAILURE_SUMMARY_WIDTH);
  const relatedTarget = sanitizeRelatedTarget(input.relatedTarget);
  const dedupeHash = failureDedupeHash({
    category: input.category,
    relatedTarget,
    failureSummary,
    projectScope: state.projectScope,
  });
  return {
    id: randomUUID(),
    createdAt: iso,
    lastSeen: iso,
    projectScope: state.projectScope,
    sourceRef: clamp(input.sourceRef, 120),
    category: input.category,
    failureSummary,
    rootCauseGuess: clamp(input.rootCauseGuess, ROOT_CAUSE_WIDTH),
    inferred: true,
    avoidNextTime: clamp(input.avoidNextTime, AVOID_WIDTH),
    ...(relatedTarget ? { relatedTarget } : {}),
    severity: input.severity ?? "medium",
    dedupeHash,
    count: 1,
    status: "active",
  };
}

// 去重合并：相同 dedupeHash 命中已有 active/ignored 记录时，合并 count/lastSeen 并
// 刷新最近 sourceRef/summary，不无限追加；resolved 记录被相同失败再次命中则重新 active。
// 返回 { record, isNew }；isNew=false 表示合并到既有记录。
export function mergeFailureRecord(
  state: FailureLearningState,
  input: FailureLearningInput,
  now: Date = new Date(),
): { record: FailureLearningRecord; isNew: boolean } {
  const candidate = buildFailureRecord(state, input, now);
  const existing = state.records.find((r) => r.dedupeHash === candidate.dedupeHash);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = candidate.lastSeen;
    existing.sourceRef = candidate.sourceRef;
    existing.failureSummary = candidate.failureSummary;
    existing.rootCauseGuess = candidate.rootCauseGuess;
    existing.avoidNextTime = candidate.avoidNextTime;
    if (candidate.relatedTarget) existing.relatedTarget = candidate.relatedTarget;
    existing.severity = candidate.severity;
    if (existing.status === "resolved") existing.status = "active";
    return { record: existing, isNew: false };
  }
  state.records.unshift(candidate);
  if (state.records.length > MAX_FAILURE_RECORDS) {
    state.records.length = MAX_FAILURE_RECORDS;
  }
  return { record: candidate, isNew: true };
}

export async function commitFailureLearningInput(
  state: FailureLearningState,
  input: FailureLearningInput,
  commitGuard?: () => boolean,
): Promise<FailureLearningCommitResult> {
  if (commitGuard && !commitGuard()) return { status: "stale" };
  const candidate = buildFailureRecord(state, input);
  try {
    return await withMemoryDirectoryLock(state.directory, async (lockToken) => {
      await recoverMemoryReplacementArtifacts(state.directory);
      const records = await loadFailureRecordsUnlocked(state);
      if (commitGuard && !commitGuard()) return { status: "stale" };

      const matching = records
        .filter((record) => record.dedupeHash === candidate.dedupeHash)
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        );
      const canonical = matching[0];
      const canonicalUpdatedAt = canonical?.status === "resolved"
        ? await stat(join(state.directory, `${canonical.id}.json`))
            .then((value) => value.mtimeMs)
            .catch((error) => {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
              throw error;
            })
        : 0;
      const resolvedAfterCaptureStarted =
        canonical?.status === "resolved" &&
        canonicalUpdatedAt >= Date.parse(candidate.createdAt);
      const record = canonical
        ? {
            ...canonical,
            lastSeen: candidate.lastSeen,
            sourceRef: candidate.sourceRef,
            failureSummary: candidate.failureSummary,
            rootCauseGuess: candidate.rootCauseGuess,
            avoidNextTime: candidate.avoidNextTime,
            ...(candidate.relatedTarget ? { relatedTarget: candidate.relatedTarget } : {}),
            severity: candidate.severity,
            count: canonical.count + 1,
            status:
              canonical.status === "resolved" && !resolvedAfterCaptureStarted
                ? ("active" as const)
                : canonical.status,
          }
        : candidate;
      if (commitGuard && !commitGuard()) return { status: "stale" };
      const committed = await atomicWriteMemoryFile(
        join(state.directory, `${record.id}.json`),
        `${JSON.stringify(record, null, 2)}\n`,
        lockToken,
        commitGuard,
      );
      if (!committed) return { status: "stale" };
      const committedRecords = coalesceFailureRecords([
        ...records.filter((item) => item.id !== record.id),
        record,
      ]);
      if (!commitGuard || commitGuard()) state.records = committedRecords;
      return {
        status: "committed",
        record:
          committedRecords.find((item) => item.dedupeHash === record.dedupeHash) ?? record,
        records: committedRecords,
      };
    });
  } catch (error) {
    recordFailureLearningDegradedWarning(
      state,
      `write_failed directory=${state.directory} reason=${formatError(error)}`,
    );
    throw error;
  }
}

// 持久化：一条记录一个 <id>.json（模仿 memory 存储范式）。Windows 路径经 node:path join 兼容。
export async function writeFailureRecord(
  state: FailureLearningState,
  record: FailureLearningRecord,
): Promise<void> {
  let previousStatus: FailureLearningStatus | undefined;
  try {
    await withMemoryDirectoryLock(state.directory, async (lockToken) => {
      await recoverMemoryReplacementArtifacts(state.directory);
      const persisted = await loadFailureRecordsUnlocked(state);
      const matching = persisted
        .filter((item) => item.dedupeHash === record.dedupeHash)
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        );
      const latest = matching[0] ?? persisted.find((item) => item.id === record.id);
      previousStatus = latest?.status;
      const logicalCount = coalesceFailureRecords(matching)[0]?.count ?? 0;
      const incomingCountDelta = Math.max(0, record.count - logicalCount);
      const next = latest
        ? incomingCountDelta > 0
          ? {
              ...record,
              id: latest.id,
              createdAt: latest.createdAt,
              count: latest.count + incomingCountDelta,
            }
          : { ...latest, status: record.status }
        : record;
      await atomicWriteMemoryFile(
        join(state.directory, `${next.id}.json`),
        `${JSON.stringify(next, null, 2)}\n`,
        lockToken,
      );
      const committedRecords = coalesceFailureRecords([
        ...persisted.filter((item) => item.id !== next.id),
        next,
      ]);
      state.records = committedRecords;
    });
  } catch (error) {
    if (previousStatus) {
      record.status = previousStatus;
      const local = state.records.find((item) => item.dedupeHash === record.dedupeHash);
      if (local) local.status = previousStatus;
    }
    recordFailureLearningDegradedWarning(
      state,
      `write_failed directory=${state.directory} id=${record.id} reason=${formatError(error)}`,
    );
    throw error;
  }
}

export async function removeFailureRecordFile(
  state: FailureLearningState,
  id: string,
): Promise<void> {
  await rm(join(state.directory, `${id}.json`), { force: true });
}

function parseFailureRecord(value: unknown): FailureLearningRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.dedupeHash !== "string") return null;
  if (typeof v.category !== "string" || typeof v.failureSummary !== "string") return null;
  const status =
    v.status === "active" || v.status === "resolved" || v.status === "ignored"
      ? (v.status as FailureLearningStatus)
      : "active";
  const severity =
    v.severity === "low" || v.severity === "medium" || v.severity === "high"
      ? (v.severity as FailureLearningSeverity)
      : "medium";
  return {
    id: v.id,
    createdAt: typeof v.createdAt === "string" ? v.createdAt : new Date(0).toISOString(),
    lastSeen: typeof v.lastSeen === "string" ? v.lastSeen : new Date(0).toISOString(),
    projectScope: typeof v.projectScope === "string" ? v.projectScope : "project",
    sourceRef: typeof v.sourceRef === "string" ? v.sourceRef : "",
    category: v.category as FailureLearningCategory,
    failureSummary: v.failureSummary,
    rootCauseGuess: typeof v.rootCauseGuess === "string" ? v.rootCauseGuess : "",
    inferred: true,
    avoidNextTime: typeof v.avoidNextTime === "string" ? v.avoidNextTime : "",
    ...(typeof v.relatedTarget === "string" ? { relatedTarget: v.relatedTarget } : {}),
    severity,
    dedupeHash: v.dedupeHash,
    count: typeof v.count === "number" && v.count > 0 ? v.count : 1,
    status,
  };
}

async function loadFailureRecordsUnlocked(state: FailureLearningState): Promise<FailureLearningRecord[]> {
  let files: string[];
  try {
    files = await readdir(state.directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    recordFailureLearningDegradedWarning(
      state,
      `read_failed directory=${state.directory} reason=${formatError(error)}`,
    );
    throw error;
  }
  const records: FailureLearningRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    let content: string;
    try {
      content = await readFile(join(state.directory, file), "utf8");
    } catch (error) {
      recordFailureLearningDegradedWarning(
        state,
        `read_failed directory=${state.directory} file=${file} reason=${formatError(error)}`,
      );
      throw error;
    }
    try {
      const parsed = parseFailureRecord(JSON.parse(content));
      if (parsed) records.push(parsed);
    } catch {
      // 坏文件跳过，不打断加载。
    }
  }
  return records;
}

function coalesceFailureRecords(records: FailureLearningRecord[]): FailureLearningRecord[] {
  const groups = new Map<string, FailureLearningRecord[]>();
  for (const record of records) {
    const matching = groups.get(record.dedupeHash);
    if (matching) matching.push(record);
    else groups.set(record.dedupeHash, [record]);
  }
  return [...groups.values()]
    .map((matching) => {
      matching.sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      );
      const canonical = matching[0];
      const latest = matching.reduce((current, item) =>
        item.lastSeen > current.lastSeen ? item : current,
      );
      return {
        ...latest,
        id: canonical.id,
        createdAt: canonical.createdAt,
        status: canonical.status,
        count: matching.reduce((total, item) => total + item.count, 0),
      };
    })
    .sort((left, right) => right.lastSeen.localeCompare(left.lastSeen))
    .slice(0, MAX_FAILURE_RECORDS);
}

export async function loadFailureRecords(
  state: FailureLearningState,
): Promise<FailureLearningRecord[]> {
  try {
    return await withMemoryDirectoryLock(state.directory, async () => {
      await recoverMemoryReplacementArtifacts(state.directory);
      return coalesceFailureRecords(await loadFailureRecordsUnlocked(state));
    });
  } catch (error) {
    recordFailureLearningDegradedWarning(
      state,
      `read_failed directory=${state.directory} reason=${formatError(error)}`,
    );
    return [...state.records];
  }
}

export function recordFailureLearningDegradedWarning(
  state: FailureLearningState,
  warning: string,
): void {
  const sanitized = sanitizeFailureText(warning).slice(0, 240);
  if (!sanitized || state.degradedWarnings.includes(sanitized)) {
    return;
  }
  state.degradedWarnings.unshift(sanitized);
  state.degradedWarnings = state.degradedWarnings.slice(0, 5);
}

export function findFailureRecord(
  state: FailureLearningState,
  id: string | undefined,
): FailureLearningRecord | undefined {
  if (!id) return undefined;
  return state.records.find((r) => r.id === id || r.id.startsWith(id));
}

const SEVERITY_RANK: Record<FailureLearningSeverity, number> = { high: 3, medium: 2, low: 1 };

// 仅取当前项目 active 记录，按 severity → 最近优先排序，返回少量高价值教训。
export function selectActiveLessons(
  state: FailureLearningState,
  limit: number = PROMPT_TOP_K,
): FailureLearningRecord[] {
  return state.records
    .filter((r) => r.status === "active" && r.projectScope === state.projectScope)
    .sort((a, b) => {
      const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      return sev !== 0 ? sev : b.lastSeen.localeCompare(a.lastSeen);
    })
    .slice(0, limit);
}

// Prompt 投影：紧凑 JSON，只含 category/avoid/severity/count，不含 secret/baseUrl/长路径/sourceRef 内部细节。
// 返回 null 表示无 active 教训（调用方不注入）。长度在 item 层面控制：优先保留排序后的
// 高价值记录，超长时逐条减少，保证 text 始终是合法 JSON（绝不对 JSON 字符串硬截断）。
export function buildFailureLearningSummaryForPrompt(
  state: FailureLearningState,
): { count: number; text: string } | null {
  const lessons = selectActiveLessons(state);
  if (lessons.length === 0) return null;
  const items = lessons.map((r) => ({
    category: r.category,
    avoid: clamp(r.avoidNextTime, PROMPT_ITEM_WIDTH),
    severity: r.severity,
    count: r.count,
  }));
  // 从全部高价值条目开始，必要时逐条丢弃尾部（较低价值）记录，直到 JSON 长度受控。
  // 至少保留 1 条（最高价值），避免空投影；单条本身经 PROMPT_ITEM_WIDTH 截断，长度有界。
  let kept = items.length;
  let json = JSON.stringify(items);
  while (json.length > PROMPT_TOTAL_WIDTH && kept > 1) {
    kept -= 1;
    json = JSON.stringify(items.slice(0, kept));
  }
  return { count: kept, text: json };
}

export function setFailureRecordStatus(
  record: FailureLearningRecord,
  status: FailureLearningStatus,
): void {
  record.status = status;
}
