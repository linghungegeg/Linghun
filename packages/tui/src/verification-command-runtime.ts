import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Writable } from "node:stream";
import type { Language } from "@linghun/shared";
import type { TuiContext } from "./index.js";
import { formatBackgroundTask } from "./job-runner-presenter.js";
import { createProcessGuard } from "./process-guard.js";
import { truncateDisplay, writeLine } from "./startup-runtime.js";
import { rememberBackgroundTask } from "./tui-agent-job-runtime.js";
import type {
  BackgroundTaskState,
  VerificationCommandResult,
  VerificationReport,
  VerificationRuntimeStatus,
  VerificationStep,
  VerificationStepKind,
} from "./tui-data-types.js";
import { isRecord } from "./tui-state-runtime.js";
const VERIFICATION_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export async function createVerificationPlan(
  projectPath: string,
  mode: "default" | "smoke",
): Promise<VerificationStep[]> {
  if (mode === "smoke") {
    return [
      {
        kind: "smoke",
        command: "node -e \"console.log('linghun verify smoke')\"",
        reason:
          "最小合成 smoke：仅确认 Verification Runner 可执行命令并归档 evidence；不是真实 provider/TUI/render/report 主链 smoke。",
        synthetic: true,
      },
    ];
  }

  const packageJson = await safeReadJson(join(projectPath, "package.json"));
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};
  const steps: VerificationStep[] = [];
  addPackageStep(steps, scripts, "typecheck", "typecheck", "TypeScript 类型检查。 ");
  addPackageStep(steps, scripts, "test", "test", "项目测试套件。 ");
  addPackageStep(steps, scripts, "lint", "lint", "lint 静态检查。 ");
  addPackageStep(steps, scripts, "build", "build", "构建验证。 ");
  addPackageStep(steps, scripts, "smoke", "smoke", "项目自定义 smoke 验证。 ");

  if (steps.length > 0) {
    return steps;
  }
  return [
    {
      kind: "smoke",
      command: "node --version",
      reason: "未发现项目验证脚本，降级为 Node 运行环境 smoke 检查。",
      synthetic: true,
    },
  ];
}

export function addPackageStep(
  steps: VerificationStep[],
  scripts: Record<string, unknown>,
  scriptName: string,
  kind: VerificationStepKind,
  reason: string,
): void {
  if (typeof scripts[scriptName] !== "string") {
    return;
  }
  steps.push({ kind, command: `corepack pnpm ${scriptName}`, reason });
}

export async function runVerificationPlan(
  plan: VerificationStep[],
  context: TuiContext,
  sessionId: string,
  output: Writable,
  appendBackgroundTaskEvent: (
    context: TuiContext,
    sessionId: string,
    task: BackgroundTaskState,
  ) => Promise<void>,
): Promise<VerificationReport> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const logRoot = join(context.projectPath, ".linghun", "logs", "verification");
  await mkdir(logRoot, { recursive: true });
  const controller = new AbortController();
  context.activeVerificationAbortController = controller;
  context.interrupt = { type: "running", taskId: runId, canCancel: true };
  const task: BackgroundTaskState = {
    id: runId,
    kind: "verification",
    title: "Verification Runner",
    status: "running",
    currentStep: "preparing verification",
    progress: { completed: 0, total: plan.length, label: "verify" },
    startedAt,
    updatedAt: startedAt,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    logPath: logRoot,
    hasOutput: false,
    userVisibleSummary: `验证已启动：${plan.length} 个步骤。可用 /background 查看详情。`,
    nextAction: "等待 PASS / FAIL / PARTIAL 结果，失败后按建议修复并复跑 /verify。",
  };
  rememberBackgroundTask(context, task);
  await context.store.appendEvent(sessionId, {
    type: "verification_start",
    run: { id: runId, plan, startedAt },
    createdAt: startedAt,
  });
  await appendBackgroundTaskEvent(context, sessionId, task);
  writeLine(output, formatBackgroundTask(task, context.language));

  const results: VerificationCommandResult[] = [];
  const unverified: string[] = [];
  const risk: string[] = [];
  try {
    for (const [index, step] of plan.entries()) {
      const stepStarted = Date.now();
      task.currentStep = `${step.kind} ${index + 1}/${plan.length}`;
      task.progress = { completed: index, total: plan.length, label: step.kind };
      task.updatedAt = new Date().toISOString();
      await appendBackgroundTaskEvent(context, sessionId, task);
      writeLine(output, `验证步骤：${task.currentStep} · ${step.command}`);

      const logPath = join(logRoot, `${runId}-${index + 1}-${step.kind}.log`);
      const result = await runVerificationCommand(
        step.command,
        context.projectPath,
        controller.signal,
      );
      const durationMs = Date.now() - stepStarted;
      const runnerErrorLine = result.runnerError ? `runnerError=${result.runnerError}\n` : "";
      const fullLog = `$ ${step.command}\nexitCode=${result.exitCode}\noutcome=${result.outcome}\n${runnerErrorLine}durationMs=${durationMs}\n\n${result.output}`;
      await writeFile(logPath, fullLog, "utf8");
      const summary = summarizeVerificationOutput(
        result.output,
        result.exitCode,
        result.runnerError,
      );
      const wasMarkedStale = task.status === "stale";
      const commandStatus: VerificationRuntimeStatus =
        result.outcome === "cancelled"
          ? "cancelled"
          : result.outcome === "timeout"
            ? "timeout"
            : wasMarkedStale
              ? "stale"
              : result.runnerError
                ? "partial"
                : result.exitCode === 0
                  ? "pass"
                  : "fail";
      if (commandStatus === "fail") {
        risk.push(`${step.kind} 失败：${summary}`);
      }
      if (commandStatus === "partial") {
        unverified.push(`${step.kind} runner error：${summary}`);
        risk.push(`${step.kind} runner/toolchain 兼容风险：${summary}`);
      }
      if (commandStatus === "cancelled" || commandStatus === "timeout") {
        unverified.push(`${step.kind} ${commandStatus}：${summary}`);
        risk.push(`${step.kind} 未完成：${commandStatus}；不得生成 PASS 证据。`);
      }
      if (commandStatus === "stale") {
        unverified.push(`${step.kind} stale：${summary}`);
        risk.push(`${step.kind} 曾被标记为 stale；即使命令随后结束，也不得生成 PASS 证据。`);
      }
      results.push({
        ...step,
        status: commandStatus,
        exitCode: result.exitCode,
        durationMs,
        logPath,
        summary,
        runnerError: result.runnerError,
      });
      task.lastOutputAt = new Date().toISOString();
      task.hasOutput = Boolean(result.output.trim());
      if (
        commandStatus === "cancelled" ||
        commandStatus === "timeout" ||
        commandStatus === "stale"
      ) {
        break;
      }
    }

    const endedAt = new Date().toISOString();
    const failed = results.filter((item) => item.status === "fail");
    const partial = results.filter((item) => item.status === "partial");
    const cancelled = results.filter((item) => item.status === "cancelled");
    const timedOut = results.filter((item) => item.status === "timeout");
    const stale = results.filter((item) => item.status === "stale");
    const hasRunnerError = partial.some((item) => item.runnerError);
    const status: VerificationReport["status"] =
      cancelled.length > 0
        ? "cancelled"
        : timedOut.length > 0
          ? "timeout"
          : stale.length > 0
            ? "stale"
            : failed.length > 0
              ? "fail"
              : partial.length > 0 || unverified.length > 0
                ? "partial"
                : "pass";
    const report: VerificationReport = {
      id: runId,
      status,
      summary:
        status === "pass"
          ? `PASS：${results.length} 个验证步骤通过。`
          : status === "fail"
            ? `FAIL：${failed.length}/${results.length} 个验证步骤失败。`
            : status === "cancelled"
              ? "CANCELLED：验证已取消，未生成 PASS 证据。"
              : status === "timeout"
                ? "TIMEOUT：验证超时，未生成 PASS 证据。"
                : status === "stale"
                  ? "STALE：验证任务疑似卡住，未生成 PASS 证据。"
                  : hasRunnerError
                    ? "PARTIAL：验证命令已运行，但 runner/toolchain 退出清理异常。"
                    : `PARTIAL：${unverified.length} 项未验证。`,
      commands: results,
      unverified,
      risk,
      logPath: logRoot,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      nextAction:
        status === "pass"
          ? "可继续审查结果或进入交付总结。"
          : hasRunnerError
            ? "查看 runner error 日志，记录 Node 版本，并建议用 Node 22 LTS 复核。"
            : "先查看失败命令与日志，修复后复跑 /verify。",
    };
    task.status =
      status === "fail"
        ? "failed"
        : status === "cancelled" || status === "timeout" || status === "stale"
          ? status
          : "completed";
    task.result = status;
    task.currentStep = status === "pass" ? "verification finished" : `verification ${status}`;
    task.progress = { completed: results.length, total: plan.length, label: "verify" };
    task.updatedAt = endedAt;
    task.nextAction = report.nextAction;
    task.userVisibleSummary = report.summary;
    await appendBackgroundTaskEvent(context, sessionId, task);
    await context.store.appendEvent(sessionId, {
      type: "verification_end",
      report,
      createdAt: endedAt,
    });
    return report;
  } finally {
    if (context.activeVerificationAbortController === controller) {
      context.activeVerificationAbortController = undefined;
    }
    context.interrupt = { type: "idle" };
  }
}

export async function runVerificationCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = VERIFICATION_COMMAND_TIMEOUT_MS,
): Promise<{
  exitCode: number;
  output: string;
  outcome: "completed" | "timeout" | "cancelled";
  runnerError?: string;
}> {
  return new Promise((resolveCommand) => {
    const detached = process.platform !== "win32";
    const child = spawn(command, { cwd, shell: true, detached, windowsHide: true });
    const guard = createProcessGuard();
    guard.track(child, { detached, label: "verification" });
    let output = "";
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const scheduleForceStop = () => {
      forceTimer = setTimeout(() => guard.requestStop(true), 1_000);
    };
    const settle = (result: {
      exitCode: number;
      output: string;
      outcome?: "completed" | "timeout" | "cancelled";
      runnerError?: string;
    }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forceTimer && result.outcome === undefined) {
        clearTimeout(forceTimer);
      }
      signal?.removeEventListener("abort", onAbort);
      resolveCommand({ ...result, outcome: result.outcome ?? "completed" });
    };
    const onAbort = () => {
      const runnerError = "runner cancelled by interrupt";
      output = output ? `${output}\n${runnerError}` : runnerError;
      guard.requestStop(false);
      scheduleForceStop();
      settle({ exitCode: 1, output, outcome: "cancelled", runnerError });
    };
    const timeout = setTimeout(() => {
      const runnerError = `runner timeout after ${timeoutMs}ms`;
      output = output ? `${output}\n${runnerError}` : runnerError;
      guard.requestStop(false);
      scheduleForceStop();
      settle({ exitCode: 1, output, outcome: "timeout", runnerError });
    }, timeoutMs);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      const runnerError = `runner error: ${error.message}`;
      settle({
        exitCode: 1,
        output: output ? `${output}\n${runnerError}` : runnerError,
        runnerError,
      });
    });
    child.on("close", (code, childSignal) => {
      const exitCode = code ?? 1;
      const runnerError = detectRunnerCompatibilityError(output, exitCode, childSignal);
      settle({ exitCode, output, runnerError });
    });
  });
}

export function detectRunnerCompatibilityError(
  output: string,
  exitCode: number,
  signal: NodeJS.Signals | null,
): string | undefined {
  if (signal) {
    return `runner stopped by signal ${signal}`;
  }
  if (exitCode === 0) {
    return undefined;
  }
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const normalized = output.replace(ansiPattern, "");
  const vitestPassed =
    /Test Files\s+\d+\s+passed/i.test(normalized) && /Tests\s+\d+\s+passed/i.test(normalized);
  const nodeCleanupError =
    normalized.includes("TypeError: emitter.removeListener is not a function") ||
    normalized.includes("emitter.removeListener is not a function");
  if (vitestPassed && nodeCleanupError) {
    return "runner/toolchain cleanup error after tests passed; verify again with Node 22 LTS";
  }
  const childSignal = normalized.match(/\bSIG(?:TERM|KILL|INT|HUP|ABRT)\b/);
  if (childSignal) {
    return `runner/child stopped by signal ${childSignal[0]}`;
  }
  return undefined;
}

export function createReviewReport(context: TuiContext): string {
  const changedFiles =
    context.tools.changedFiles.length > 0 ? context.tools.changedFiles : ["未记录改动"];
  const verification = context.lastVerification;
  const conservativeStatuses: VerificationReport["status"][] = [
    "fail",
    "partial",
    "cancelled",
    "timeout",
    "stale",
  ];
  const conservative = verification ? conservativeStatuses.includes(verification.status) : true;
  const priority =
    verification?.status === "fail" ||
    verification?.status === "timeout" ||
    verification?.status === "stale"
      ? "P0"
      : conservative
        ? "P1"
        : "P2";
  const risk = verification
    ? verification.risk.length > 0
      ? verification.risk.join("; ")
      : `最近验证为 ${verification.status.toUpperCase()}`
    : "尚未运行 /verify，不能声称 PASS 或已验证。";
  const suggestion =
    verification?.status === "fail"
      ? "先按失败命令日志修复，再复跑 /verify。"
      : verification?.status === "partial"
        ? "先查看 runner error 日志；如为 Node/工具链退出清理异常，建议用 Node 22 LTS 复核。"
        : verification?.status === "cancelled"
          ? "验证已取消；先确认取消原因，再复跑 /verify，当前不得给 PASS verdict。"
          : verification?.status === "timeout"
            ? "验证超时；先查看日志和进程清理情况，缩小命令或修复卡住点后复跑。"
            : verification?.status === "stale"
              ? "验证任务疑似卡住；先查看 /background 和日志，必要时 /interrupt 后复跑。"
              : verification
                ? "结合 diff 人工确认需求覆盖；如有新改动请复跑 /verify。"
                : "先运行 /verify 或 /verify plan，形成 test_result evidence。";
  return [
    "Review Report",
    `- Priority: ${priority}`,
    `- Files: ${changedFiles.join(", ")}`,
    `- Risk: ${risk}`,
    `- Verdict: ${verification?.status === "pass" ? "SCOPED_PASS_WITH_EVIDENCE" : "CONSERVATIVE_NO_PASS"}`,
    `- Suggestion: ${suggestion}`,
  ].join("\n");
}

export function formatVerificationPlan(plan: VerificationStep[], language: Language): string {
  const header = language === "en-US" ? "Verification plan:" : "验证计划：";
  return [
    header,
    ...plan.map((step, index) => `${index + 1}. [${step.kind}] ${step.command} — ${step.reason}`),
  ].join("\n");
}

export function formatVerificationReport(report: VerificationReport, language: Language): string {
  const lines = [
    `${report.status.toUpperCase()} ${report.summary}`,
    language === "en-US" ? `Duration: ${report.durationMs}ms` : `耗时：${report.durationMs}ms`,
  ];
  for (const command of report.commands) {
    lines.push(
      `- [${command.status.toUpperCase()}] ${command.command} (${command.durationMs}ms) log: ${command.logPath ?? "无日志"}`,
    );
    if (command.status !== "pass") {
      lines.push(`  摘要：${command.summary}`);
    }
  }
  if (report.unverified.length > 0) {
    lines.push(`未验证：${report.unverified.join("; ")}`);
  }
  lines.push(`下一步：${report.nextAction}`);
  return lines.join("\n");
}

export function formatVerificationLast(
  report: VerificationReport | undefined,
  language: Language,
): string {
  if (!report) {
    return language === "en-US" ? "No verification has run yet." : "还没有最近验证结果。";
  }
  return formatVerificationReport(report, language);
}

export function summarizeVerificationOutput(
  output: string,
  exitCode: number,
  runnerError?: string,
): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-6).join(" | ");
  const summary = tail ? truncateDisplay(tail, 240) : "无输出";
  return runnerError
    ? `exitCode=${exitCode}; runner error=${runnerError}; ${summary}`
    : `exitCode=${exitCode}; ${summary}`;
}

export async function safeReadJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
