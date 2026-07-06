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
  probeCacheStatus?: "fresh" | "cached" | "stale";
  lastError?: string;
  nextAction: string;
};

export function formatRunnerDoctor(
  resolution: RunnerDoctorResolutionView,
  expectedProtocol: string,
  sanitizeDiagnosticText: (value: string) => string,
): string {
  return [
    `Native Runner Doctor：${resolution.status}；Node fallback ${resolution.nodeFallback}；主 TUI 不因 runner 问题崩溃。`,
    `- enabled: ${resolution.enabled ? "yes" : "no"}`,
    `- source: ${resolution.source}`,
    `- platform/arch: ${resolution.platform}/${resolution.arch}`,
    `- bundled platform/arch: ${resolution.platformArch}`,
    `- bundled candidate: ${resolution.bundledCandidateRef}`,
    `- resolved path: ${resolution.pathRef}`,
    `- version/protocol: ${resolution.version ?? "unknown"} / ${resolution.protocol ?? expectedProtocol}`,
    `- probe cache: ${resolution.probeCacheStatus ?? "none"}`,
    `- fallback reason: ${resolution.status === "available" ? "none" : resolution.lastError ? sanitizeDiagnosticText(resolution.lastError) : resolution.status}`,
    `- next action: ${resolution.nextAction}`,
    ...(resolution.processGuardContract ?? []).map((line) => `- process guard contract: ${line}`),
    "- boundary: runner only accepts Linghun-approved job specs; it is not a second provider/tool/agent runtime and cannot decide whether verification passed.",
    "- DEFERRED: managed/bundled binary distribution, signing/AV/install matrix, real native-runner process-guard smoke, and parent hard-kill/crash proof.",
  ].join("\n");
}

export function formatJobRunnerInline(job: DurableJobState): string {
  if (!job.runner) {
    return "runner not started; Node/TUI default";
  }
  const heartbeat = job.runner.heartbeatAt ? `; heartbeat ${job.runner.heartbeatAt}` : "";
  return `runner ${job.runner.adapter}/${job.runner.status}; resolution ${job.runner.resolution}; fallback ${job.runner.fallbackReason ?? "none"}${heartbeat}`;
}

export function formatJobRunnerReportLine(job: DurableJobState): string {
  if (!job.runner) {
    return "- runner: not_started; Node/TUI default path remains active.";
  }
  const logRefs = job.runner.logRefs
    ? `; logs state ${job.runner.logRefs.state}, stdout ${job.runner.logRefs.stdout}, stderr ${job.runner.logRefs.stderr}`
    : "";
  return `- runner: enabled ${job.runner.enabled}; adapter ${job.runner.adapter}; status ${job.runner.status}; resolution ${job.runner.resolution}; path ${job.runner.pathRef ?? "-"}; protocol ${job.runner.protocol ?? "unknown"}; version ${job.runner.version ?? "unknown"}; heartbeat ${job.runner.heartbeatAt ?? "-"}; fallback ${job.runner.fallbackReason ?? "none"}; last error ${job.runner.lastError ?? "none"}; next ${job.runner.nextAction}${logRefs}`;
}

export function mapDurableJobToBackgroundStatus(
  status: DurableJobState["status"],
): BackgroundTaskStatus {
  if (status === "created" || status === "sleeping") {
    return "paused";
  }
  if (status === "blocked") return "blocked";
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
  if (job.status === "created" || job.status === "sleeping") {
    return language === "en-US"
      ? `Use /job resume ${job.id} when the handoff/resource guard is ready, or inspect /job report ${job.id}.`
      : `handoff/resource guard 就绪后用 /job resume ${job.id}；也可先看 /job report ${job.id}。`;
  }
  if (job.status === "blocked") {
    const reason = job.pauseReason ?? "";
    if (reason.startsWith("needs_handoff_repair:")) {
      return language === "en-US"
        ? `Repair the handoff packet or evidence state, then /job resume ${job.id}.`
        : `先修复 handoff/evidence 状态，再用 /job resume ${job.id}。`;
    }
    if (reason.startsWith("agent_blocked:")) {
      return language === "en-US"
        ? `Inspect /job report ${job.id} and /job logs ${job.id}; resume after fixing the blocked child agent cause.`
        : `查看 /job report ${job.id} 和 /job logs ${job.id}；修复 child agent 阻塞原因后再 resume。`;
    }
    if (reason.includes("provider") || reason.includes("model") || reason.includes("api_key")) {
      return language === "en-US"
        ? `Fix model/provider configuration, then /job resume ${job.id}.`
        : `先修复模型/provider 配置，再用 /job resume ${job.id}。`;
    }
    return language === "en-US"
      ? `Inspect /job report ${job.id} and /job logs ${job.id}; resume after fixing the blocked reason.`
      : `查看 /job report ${job.id} 和 /job logs ${job.id}；修复阻塞原因后再 resume。`;
  }
  if (job.status === "stale") {
    return language === "en-US"
      ? `Inspect /job report ${job.id} and /job logs ${job.id}; resume only after owner/heartbeat state is clear.`
      : `先查看 /job report ${job.id} 和 /job logs ${job.id}；确认 owner/heartbeat 状态后再恢复。`;
  }
  if (job.status === "timeout") {
    return language === "en-US"
      ? `Inspect /job report ${job.id} and /job logs ${job.id}; rerun with an explicit budget/runtime only if needed.`
      : `查看 /job report ${job.id} 和 /job logs ${job.id}；确需重跑时显式设置预算/运行时。`;
  }
  if (job.status === "cancelled") {
    return language === "en-US"
      ? `Inspect /job report ${job.id} or /job logs ${job.id}; create a new job if work should continue.`
      : `查看 /job report ${job.id} 或 /job logs ${job.id}；需要继续时新建 job。`;
  }
  if (job.status === "completed") {
    return language === "en-US"
      ? `Review /job report ${job.id} and /job logs ${job.id}; run verification before treating the work as passed.`
      : `复核 /job report ${job.id} 和 /job logs ${job.id}；通过验证前不要当作已通过。`;
  }
  return language === "en-US"
    ? `Inspect /job report ${job.id} and /job logs ${job.id}; lifecycle status is not verification evidence.`
    : `查看 /job report ${job.id} 和 /job logs ${job.id}；生命周期状态不是验证证据。`;
}

export function formatBackgroundDetails(
  task: BackgroundTaskState,
  language: Language,
  projectPath?: string,
): string {
  const progress = task.progress ? formatTaskProgress(task) : "none";
  const fallbackTitle = language === "en-US" ? "Background task" : "后台任务";
  return [
    language === "en-US" ? `Background ${safeTaskId(task)}` : `Background ${safeTaskId(task)}`,
    `- kind: ${safeTaskKind(task)}`,
    `- title: ${truncateLine(safeText(task.title, fallbackTitle), 72)}`,
    `- status: ${safeTaskStatus(task)}; result ${safeText(task.result, "-")}`,
    `- current step: ${truncateLine(safeText(task.currentStep, "-"), 72)}`,
    `- progress: ${progress}`,
    `- why stale/blocked: ${formatBackgroundReason(task, language)}`,
    `- resume/cancel: ${truncateLine(formatTaskText(task, task.nextAction, projectPath), 96)}`,
    `- summary: ${truncateLine(formatTaskText(task, task.userVisibleSummary, projectPath), 120)}`,
    `- log path: ${formatDisplayPath(task.logPath, projectPath)}`,
    `- output path: ${formatDisplayPath(task.outputPath, projectPath)}`,
    `- has output: ${safeText(task.hasOutput, "false")}`,
    `- started at: ${safeText(task.startedAt, "-")}`,
    `- updated at: ${safeText(task.updatedAt, "-")}`,
  ].join("\n");
}

export function formatBackgroundOutputDetails(
  task: BackgroundTaskState,
  language: Language,
  projectPath?: string,
): string {
  const location = task.outputPath ?? task.logPath;
  if (!location) {
    return language === "en-US"
      ? `Background ${safeTaskId(task)} has no output path yet.`
      : `Background ${safeTaskId(task)} 尚无输出路径。`;
  }
  return [
    `Background output ${safeTaskId(task)}`,
    `- path: ${formatDisplayPath(location, projectPath)}`,
    `- hasOutput: ${safeText(task.hasOutput, "false")}`,
    `- status: ${safeTaskStatus(task)}`,
    `- summary: ${formatTaskText(task, task.userVisibleSummary, projectPath)}`,
    `- slices: /details output ${safeTaskId(task)} --tail 40 | --grep <pattern> --context 2 | --errors`,
  ].join("\n");
}

export function formatBackgroundTask(task: BackgroundTaskState, language: Language): string {
  const progress = task.progress ? ` ${formatTaskProgress(task)}` : "";
  const elapsed = formatElapsedSince(task.startedAt);
  const title = truncateLine(
    cleanPanelText(task.title, language === "en-US" ? "Background task" : "后台任务"),
    28,
  );
  const step = truncateLine(cleanPanelText(task.currentStep, "-"), 30);
  return language === "en-US"
    ? `[background] ${title} · ${safeTaskStatus(task)} · ${step}${progress} · elapsed ${elapsed}`
    : `[后台] ${title} · ${safeTaskStatus(task)} · ${step}${progress} · 耗时 ${elapsed}`;
}

export function formatBackgroundTaskPanelRow(
  task: BackgroundTaskState,
  language: Language,
): string {
  const progress = formatPanelProgress(task);
  const step = cleanPanelText(task.currentStep, "-");
  const nextAction = cleanPanelText(formatTaskText(task, task.nextAction, undefined), "-");
  const title = cleanPanelText(task.title, language === "en-US" ? "Background task" : "后台任务");
  return [
    truncateLine(title, 28),
    normalizePanelStatus(safeTaskStatus(task), language),
    progress,
    truncateLine(step, 28),
    truncateLine(nextAction, 42),
  ].join(" · ");
}

export function formatBackgroundTaskPanelDetails(
  task: BackgroundTaskState,
  language: Language,
  projectPath?: string,
): string {
  const progress = formatPanelProgress(task);
  return [
    cleanPanelText(task.title, language === "en-US" ? "Background task" : "后台任务"),
    `- status: ${normalizePanelStatus(safeTaskStatus(task), language)}`,
    `- progress: ${progress}`,
    `- current step: ${cleanPanelText(task.currentStep, "-")}`,
    `- next action: ${cleanPanelText(formatTaskText(task, task.nextAction, projectPath), "-", true)}`,
    `- details: /details background ${safeTaskId(task)}`,
    task.hasOutput ? `- output: /details output ${safeTaskId(task)}` : undefined,
    task.logPath ? `- log: ${formatDisplayPath(task.logPath, projectPath)}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
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
      ? `${task.status}; this is not evidence that verification passed`
      : `${task.status}；这不是验证已通过的证据`;
  }
  return language === "en-US" ? "not stale" : "未 stale";
}

function truncateLine(value: unknown, max: number): string {
  const normalized = safeText(value, "-").replace(/\s+/gu, " ").trim();
  if (normalized.length <= max) return normalized;
  if (max <= 1) return "…";
  return `${normalized.slice(0, max - 1)}…`;
}

function formatPanelProgress(task: BackgroundTaskState): string {
  if (!task.progress) return "-";
  return formatTaskProgress(task);
}

function formatTaskProgress(task: BackgroundTaskState): string {
  if (!task.progress) return "-";
  const total = typeof task.progress.total === "number" ? task.progress.total : undefined;
  const ratio = total ? `${task.progress.completed}/${total}` : `${task.progress.completed}`;
  return task.progress.label ? `${ratio} ${task.progress.label}` : ratio;
}

function normalizePanelStatus(status: BackgroundTaskState["status"] | string, language: Language): string {
  const isEn = language === "en-US";
  if (status === "paused") return isEn ? "sleeping" : "sleeping";
  if (status === "blocked") return isEn ? "blocked" : "阻塞";
  if (status === "stale") return isEn ? "stale" : "stale";
  if (status === "timeout") return isEn ? "timeout" : "timeout";
  if (status === "failed") return isEn ? "failed" : "失败";
  if (status === "completed") return isEn ? "completed" : "已完成";
  if (status === "cancelled") return isEn ? "cancelled" : "已取消";
  return isEn ? "running" : "运行中";
}

function formatTaskText(
  task: BackgroundTaskState,
  value: unknown,
  projectPath: string | undefined,
): string {
  const sanitized = sanitizeDisplayPaths(safeText(value, "-"), projectPath);
  return task.kind === "job" ? normalizeJobPassWording(sanitized) : sanitized;
}

function normalizeJobPassWording(value: string): string {
  return value
    .replace(
      /\bno PASS evidence generated\b/giu,
      "no evidence that verification passed was generated",
    )
    .replace(
      /\bnever count as verification PASS\b/giu,
      "never count as evidence that verification passed",
    )
    .replace(/\bverification PASS\b/giu, "verification passed")
    .replace(/\bPASS evidence\b/giu, "evidence that verification passed");
}

function cleanPanelText(value: unknown, fallback: string, preserveRefs = false): string {
  let cleaned = safeText(value, fallback)
    .replace(
      /\b(sourceRef|schema|debug|gate retry|passEvidence|raw evidence|tool_result raw|raw tool result|endpoint|runner=|evidenceRefs?|planId|runId|workflowId|forkId|threadId|system_event|provider abort|provider_abort|abort signal)\b/giu,
      "",
    )
    .replace(
      /\b(gateId|requestId|schemaLoaded|trustLevel|endpointPath|fullOutputPath|logPath)\b/giu,
      "",
    )
    .replace(/[A-Za-z]:[\\/][^\r\n\s"'<>{}]+/gu, "[path]")
    .replace(/(?:\/[^\r\n\s"'<>{}/]+){2,}/gu, "[path]");
  if (!preserveRefs) {
    cleaned = cleaned
      .replace(/\b(workflow|agent|job|run|plan)-[A-Za-z0-9_-]{6,}\b/giu, "$1")
      .replace(
        /\b[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\b/gu,
        "id",
      );
  }
  cleaned = cleaned.replace(/\s+/gu, " ").trim();
  if (!cleaned || cleaned.toLowerCase() === "unknown") return fallback;
  return cleaned;
}

function safeText(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function safeTaskId(task: BackgroundTaskState): string {
  return cleanPanelText((task as unknown as { id?: unknown }).id, "background-task", true);
}

function safeTaskKind(task: BackgroundTaskState): string {
  return cleanPanelText((task as unknown as { kind?: unknown }).kind, "background", true);
}

function safeTaskStatus(task: BackgroundTaskState): BackgroundTaskState["status"] | string {
  return safeText((task as unknown as { status?: unknown }).status, "blocked");
}
