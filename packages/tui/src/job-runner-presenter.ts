import type { NativeRunnerConfig } from "@linghun/config";
import type { Language } from "@linghun/shared";
import type {
  BackgroundTaskState,
  BackgroundTaskStatus,
  DurableJobState,
  NativeRunnerResolutionStatus,
} from "./index.js";
import { formatDisplayPath, sanitizeDisplayPaths } from "./startup-runtime.js";

export type RunnerDoctorResolutionView = {
  status: NativeRunnerResolutionStatus;
  enabled: boolean;
  source: NativeRunnerConfig["source"];
  pathRef: string;
  bundledCandidateRef: string;
  version?: string;
  protocol?: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  platformArch: string;
  nodeFallback: "available";
  processGuardContract?: readonly string[];
  lastError?: string;
  nextAction: string;
};

export function formatRunnerDoctor(
  resolution: RunnerDoctorResolutionView,
  expectedProtocol: string,
  sanitizeDiagnosticText: (value: string) => string,
): string {
  return [
    `Native Runner Doctor：${resolution.status}；Node fallback=${resolution.nodeFallback}；主 TUI 不因 runner 问题崩溃。`,
    `- enabled: ${resolution.enabled ? "yes" : "no"}`,
    `- source: ${resolution.source}`,
    `- platform/arch: ${resolution.platform}/${resolution.arch}`,
    `- bundled platform/arch: ${resolution.platformArch}`,
    `- bundled candidate: ${resolution.bundledCandidateRef}`,
    `- resolved path: ${resolution.pathRef}`,
    `- version/protocol: ${resolution.version ?? "unknown"} / ${resolution.protocol ?? expectedProtocol}`,
    `- fallback reason: ${resolution.status === "available" ? "none" : resolution.lastError ? sanitizeDiagnosticText(resolution.lastError) : resolution.status}`,
    `- next action: ${resolution.nextAction}`,
    ...(resolution.processGuardContract ?? []).map((line) => `- process guard contract: ${line}`),
    "- boundary: runner only accepts Linghun-approved job specs; it is not a second provider/tool/agent runtime and cannot decide verification PASS.",
    "- DEFERRED: managed/bundled binary distribution, signing/AV/install matrix, real native-runner process-guard smoke, and parent hard-kill/crash proof.",
  ].join("\n");
}

export function formatJobRunnerInline(job: DurableJobState): string {
  if (!job.runner) {
    return "runner=not_started; Node/TUI default";
  }
  const heartbeat = job.runner.heartbeatAt ? `; heartbeat=${job.runner.heartbeatAt}` : "";
  return `runner=${job.runner.adapter}/${job.runner.status}; resolution=${job.runner.resolution}; fallback=${job.runner.fallbackReason ?? "none"}${heartbeat}`;
}

export function formatJobRunnerReportLine(job: DurableJobState): string {
  if (!job.runner) {
    return "- runner: not_started; Node/TUI default path remains active.";
  }
  const logRefs = job.runner.logRefs
    ? `; logs=state:${job.runner.logRefs.state},stdout:${job.runner.logRefs.stdout},stderr:${job.runner.logRefs.stderr}`
    : "";
  return `- runner: enabled=${job.runner.enabled}; adapter=${job.runner.adapter}; status=${job.runner.status}; resolution=${job.runner.resolution}; pathRef=${job.runner.pathRef ?? "-"}; protocol=${job.runner.protocol ?? "unknown"}; version=${job.runner.version ?? "unknown"}; heartbeat=${job.runner.heartbeatAt ?? "-"}; fallback=${job.runner.fallbackReason ?? "none"}; lastError=${job.runner.lastError ?? "none"}; next=${job.runner.nextAction}${logRefs}`;
}

export function mapDurableJobToBackgroundStatus(
  status: DurableJobState["status"],
): BackgroundTaskStatus {
  if (status === "created" || status === "sleeping" || status === "blocked") {
    return "paused";
  }
  return status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "stale" ||
    status === "timeout"
    ? status
    : "running";
}

export function mapDurableJobToBackgroundResult(
  status: DurableJobState["status"],
): BackgroundTaskState["result"] | undefined {
  if (status === "completed") return "partial";
  if (status === "failed") return "fail";
  if (status === "cancelled") return "cancelled";
  if (status === "stale") return "stale";
  if (status === "timeout") return "timeout";
  if (status === "blocked" || status === "sleeping") return "partial";
  return undefined;
}

export function formatJobNextAction(job: DurableJobState, language: Language): string {
  if (job.status === "running") {
    return language === "en-US"
      ? `Use /job pause ${job.id}, /job cancel ${job.id}, /job report ${job.id}, or /job logs ${job.id}.`
      : `可用 /job pause ${job.id}、/job cancel ${job.id}、/job report ${job.id} 或 /job logs ${job.id}。`;
  }
  if (job.status === "blocked") {
    return language === "en-US"
      ? "Repair the handoff packet or evidence/index state, then /job resume."
      : "先修复 handoff/evidence/index 状态，再用 /job resume。";
  }
  return language === "en-US"
    ? `Inspect /job report ${job.id}; completed/cancelled/timeout/stale/blocked never count as verification PASS.`
    : `查看 /job report ${job.id}；completed/cancelled/timeout/stale/blocked 不等于 verification PASS。`;
}

export function formatBackgroundDetails(task: BackgroundTaskState, language: Language): string {
  const progress = task.progress
    ? `${task.progress.completed}/${task.progress.total ?? "?"} ${task.progress.label ?? ""}`.trim()
    : "none";
  return [
    language === "en-US" ? `Background ${task.id}` : `Background ${task.id}`,
    `- kind: ${task.kind}`,
    `- title: ${truncateLine(task.title, 72)}`,
    `- status: ${task.status}; result=${task.result ?? "-"}`,
    `- currentStep: ${truncateLine(task.currentStep ?? "-", 72)}`,
    `- progress: ${progress}`,
    `- why stale/blocked: ${formatBackgroundReason(task, language)}`,
    `- resume/cancel: ${truncateLine(task.nextAction ?? "-", 96)}`,
    `- summary: ${truncateLine(sanitizeDisplayPaths(task.userVisibleSummary), 120)}`,
    `- logPath: ${formatDisplayPath(task.logPath)}`,
    `- outputPath: ${formatDisplayPath(task.outputPath)}`,
    `- hasOutput: ${task.hasOutput}`,
    `- startedAt: ${task.startedAt}`,
    `- updatedAt: ${task.updatedAt}`,
  ].join("\n");
}

export function formatBackgroundOutputDetails(
  task: BackgroundTaskState,
  language: Language,
): string {
  const location = task.outputPath ?? task.logPath;
  if (!location) {
    return language === "en-US"
      ? `Background ${task.id} has no output path yet.`
      : `Background ${task.id} 尚无输出路径。`;
  }
  return [
    `Background output ${task.id}`,
    `- path: ${formatDisplayPath(location)}`,
    `- hasOutput: ${task.hasOutput}`,
    `- status: ${task.status}`,
    `- summary: ${sanitizeDisplayPaths(task.userVisibleSummary)}`,
    `- slices: /details output ${task.id} --tail 40 | --grep <pattern> --context 2 | --errors`,
  ].join("\n");
}

export function formatBackgroundTask(task: BackgroundTaskState, language: Language): string {
  const progress = task.progress ? ` ${task.progress.completed}/${task.progress.total ?? "?"}` : "";
  const elapsed = formatElapsedSince(task.startedAt);
  const title = truncateLine(task.title, 32);
  const step = truncateLine(task.currentStep ?? "-", 34);
  return language === "en-US"
    ? `[background] ${title} · ${task.status} · ${step}${progress} · elapsed ${elapsed}`
    : `[后台] ${title} · ${task.status} · ${step}${progress} · 耗时 ${elapsed}`;
}

export function formatElapsedSince(startedAt: string, nowMs = Date.now()): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return "0s";
  const seconds = Math.max(0, Math.floor((nowMs - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m${rest.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${(minutes % 60).toString().padStart(2, "0")}m`;
}

function formatBackgroundReason(task: BackgroundTaskState, language: Language): string {
  if (task.status === "stale") {
    return language === "en-US"
      ? "heartbeat/output stopped; resume should inspect logs and state first"
      : "heartbeat/output 已停止；恢复前应先检查日志和状态";
  }
  if (task.status === "paused") {
    return language === "en-US"
      ? "paused by resource guard, handoff repair, or user action"
      : "因资源守卫、handoff 修复或用户操作暂停";
  }
  if (task.status === "timeout" || task.status === "cancelled") {
    return language === "en-US"
      ? `${task.status}; this is not PASS evidence`
      : `${task.status}；这不是 PASS 证据`;
  }
  return language === "en-US" ? "not stale" : "未 stale";
}

function truncateLine(value: string, max: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= max) return normalized;
  if (max <= 1) return "…";
  return `${normalized.slice(0, max - 1)}…`;
}
