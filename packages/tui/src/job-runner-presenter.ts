import type { NativeRunnerConfig } from "@linghun/config";
import type { Language } from "@linghun/shared";
import type {
  BackgroundTaskState,
  BackgroundTaskStatus,
  DurableJobState,
  NativeRunnerResolutionStatus,
} from "./index.js";

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
    "- boundary: runner only accepts Linghun-approved job specs; it is not a second provider/tool/agent runtime and cannot decide verification PASS.",
    "- DEFERRED: managed/bundled binary distribution, signing/AV/install matrix, and Unix/macOS process-group cleanup.",
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
    `- title: ${task.title}`,
    `- status: ${task.status}`,
    `- currentStep: ${task.currentStep ?? "-"}`,
    `- progress: ${progress}`,
    `- logPath: ${task.logPath ?? "-"}`,
    `- outputPath: ${task.outputPath ?? "-"}`,
    `- hasOutput: ${task.hasOutput}`,
    `- result: ${task.result ?? "-"}`,
    `- summary: ${task.userVisibleSummary}`,
    `- nextAction: ${task.nextAction ?? "-"}`,
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
    `- path: ${location}`,
    `- hasOutput: ${task.hasOutput}`,
    `- status: ${task.status}`,
    `- summary: ${task.userVisibleSummary}`,
    `- slices: /details output ${task.id} --tail 40 | --grep <pattern> --context 2 | --errors`,
  ].join("\n");
}

export function formatBackgroundTask(task: BackgroundTaskState, language: Language): string {
  const progress = task.progress ? ` ${task.progress.completed}/${task.progress.total ?? "?"}` : "";
  const output = task.hasOutput
    ? (task.logPath ?? "-")
    : language === "en-US"
      ? "no valid output yet"
      : "尚未产生有效输出";
  return language === "en-US"
    ? `[background] ${task.title} · ${task.status} · ${task.currentStep ?? "-"}${progress} · log: ${output} · next: ${task.nextAction ?? "-"}`
    : `[后台] ${task.title} · ${task.status} · ${task.currentStep ?? "-"}${progress} · 日志：${output} · 下一步：${task.nextAction ?? "-"}`;
}
