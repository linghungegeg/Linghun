import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Writable } from "node:stream";
import { resolveStoragePaths } from "@linghun/config";
import type { Language, PermissionMode } from "@linghun/shared";
import type { TuiContext } from "./index.js";
import { formatBackgroundTask } from "./job-runner-presenter.js";
import {
  recordMetaOrchestrationRuntimeEvent,
  resolveMetaOrchestrationAction,
} from "./meta-orchestration-runtime.js";
import { createProcessGuard } from "./process-guard.js";
import { LINGHUN_VERIFICATION_COMMAND_TIMEOUT_MS } from "./runtime-budget.js";
import { truncateDisplay, writeLine } from "./startup-runtime.js";
import { rememberBackgroundTask } from "./tui-agent-job-runtime.js";
import { decidePermission } from "./tui-permission-runtime.js";
import type {
  BackgroundTaskState,
  VerificationCommandResult,
  VerificationReport,
  VerificationRuntimeStatus,
  VerificationStep,
  VerificationStepKind,
  VerificationScope,
} from "./tui-data-types.js";
import { isRecord } from "./tui-state-runtime.js";
import {
  type UserActionConstraints,
  verificationStepConstraintReason,
} from "./user-action-constraints.js";

export async function createVerificationPlan(
  projectPath: string,
  mode: "default" | "smoke" | "focused" | "real-smoke",
  options: { workspaceRoot?: string; changedFiles?: string[] } = {},
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

  if (mode === "focused" && options.changedFiles !== undefined) {
    return createChangedFilesFocusedPlan(
      resolve(options.workspaceRoot ?? projectPath),
      options.changedFiles,
    );
  }

  const packageJson = await safeReadJson(join(projectPath, "package.json"));
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};
  const packageManager = await detectPackageManager(projectPath);
  if (mode === "real-smoke") {
    return createRealSmokePlan(scripts, packageManager);
  }
  const steps: VerificationStep[] = [];
  addPackageStep(
    steps,
    scripts,
    "typecheck",
    "typecheck",
    "TypeScript 类型检查。 ",
    packageManager,
  );
  addPackageStep(steps, scripts, "test", "test", "项目测试套件。 ", packageManager);
  addPackageStep(steps, scripts, "lint", "lint", "lint 静态检查。 ", packageManager);
  addPackageStep(steps, scripts, "build", "build", "构建验证。 ", packageManager);
  addPackageStep(steps, scripts, "smoke", "smoke", "项目自定义 smoke 验证。 ", packageManager);

  if (steps.length > 0) {
    if (mode === "focused") {
      const focused = steps.filter(
        (step) => step.kind === "typecheck" || step.kind === "test" || step.kind === "lint",
      );
      if (focused.length > 0) return focused;
      const lightweightFallback = steps.find((step) => step.kind === "smoke") ?? steps[0];
      return lightweightFallback ? [lightweightFallback] : [];
    }
    return steps;
  }
  if (mode === "focused") {
    return [
      {
        kind: "smoke",
        command: "node --version",
        reason:
          "未发现项目 focused 验证脚本，降级为 Node 运行环境 self-check；这是 synthetic，不能当作 real-smoke。",
        synthetic: true,
      },
    ];
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

async function createChangedFilesFocusedPlan(
  workspaceRoot: string,
  changedFiles: string[],
): Promise<VerificationStep[]> {
  const canonicalWorkspaceRoot = await realpath(workspaceRoot).catch(() => undefined);
  if (!canonicalWorkspaceRoot) return [];
  const normalizedChanges: string[] = [];
  for (const file of changedFiles) {
    const normalized = normalizeWorkspaceRelativePath(workspaceRoot, file);
    if (
      normalized &&
      await pathResolvesWithinWorkspace(workspaceRoot, canonicalWorkspaceRoot, normalized)
    ) {
      normalizedChanges.push(normalized);
    }
  }
  const rejectedCount = changedFiles.length - normalizedChanges.length;
  if (normalizedChanges.some(isRootVerificationConfig)) {
    return createProjectScriptPlan(workspaceRoot, "focused", workspaceRoot);
  }

  const packageManager = await detectPackageManager(workspaceRoot);
  const rootPackageJson = await safeReadJson(join(workspaceRoot, "package.json"));
  const rootScripts = isRecord(rootPackageJson?.scripts) ? rootPackageJson.scripts : {};
  const rootOwnsVitest = typeof rootScripts.test === "string" && /(?:^|\s)vitest(?:\s|$)/u.test(rootScripts.test);
  const packageChanges = new Map<string, string[]>();
  for (const changedFile of normalizedChanges) {
    const packageRoot = await findNearestPackageRoot(
      workspaceRoot,
      canonicalWorkspaceRoot,
      changedFile,
    );
    const files = packageChanges.get(packageRoot) ?? [];
    files.push(changedFile);
    packageChanges.set(packageRoot, files);
  }

  const steps: VerificationStep[] = [];
  const coverageGaps: string[] = rejectedCount > 0
    ? [`${rejectedCount} changed path(s) were outside the workspace or unsafe for focused verification.`]
    : [];
  for (const [packageRoot, files] of [...packageChanges.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const packageJson = await safeReadJson(join(packageRoot, "package.json"));
    const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};
    const packageSteps: VerificationStep[] = [];
    addPackageStep(packageSteps, scripts, "typecheck", "typecheck", "TypeScript 类型检查。 ", packageManager, packageRoot);
    const packageOwnsTests = packageRoot !== workspaceRoot && typeof scripts.test === "string";
    if (packageOwnsTests) {
      addPackageStep(packageSteps, scripts, "test", "test", "包级测试套件。 ", packageManager, packageRoot);
    }
    addPackageStep(packageSteps, scripts, "lint", "lint", "lint 静态检查。 ", packageManager, packageRoot);

    let hasRelevantTest = packageOwnsTests;
    if (!packageOwnsTests && rootOwnsVitest) {
      const targets = await findExactRootVitestTargets(
        workspaceRoot,
        canonicalWorkspaceRoot,
        files,
      );
      for (const target of targets) {
        packageSteps.push({
          kind: "test",
          command: formatTargetedTestCommand(packageManager, target),
          reason: `根级 Vitest 精确验证 ${target}。`,
          cwd: workspaceRoot,
        });
      }
      hasRelevantTest = targets.length > 0;
    }
    if (!hasRelevantTest) {
      coverageGaps.push(
        `No relevant focused test was found for ${relative(workspaceRoot, packageRoot).replaceAll("\\", "/") || "."}.`,
      );
    }
    steps.push(...packageSteps);
  }

  if (steps.length > 0 && coverageGaps.length > 0) {
    steps[0] = { ...steps[0], coverageGap: [...new Set(coverageGaps)].join(" ") };
  }
  return deduplicateVerificationSteps(steps);
}

async function createProjectScriptPlan(
  projectPath: string,
  mode: "default" | "focused",
  cwd: string,
): Promise<VerificationStep[]> {
  const packageJson = await safeReadJson(join(projectPath, "package.json"));
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};
  const packageManager = await detectPackageManager(projectPath);
  const steps: VerificationStep[] = [];
  addPackageStep(steps, scripts, "typecheck", "typecheck", "TypeScript 类型检查。 ", packageManager, cwd);
  addPackageStep(steps, scripts, "test", "test", "项目测试套件。 ", packageManager, cwd);
  addPackageStep(steps, scripts, "lint", "lint", "lint 静态检查。 ", packageManager, cwd);
  if (mode === "default") {
    addPackageStep(steps, scripts, "build", "build", "构建验证。 ", packageManager, cwd);
    addPackageStep(steps, scripts, "smoke", "smoke", "项目自定义 smoke 验证。 ", packageManager, cwd);
  }
  return mode === "focused"
    ? steps.filter((step) => step.kind === "typecheck" || step.kind === "test" || step.kind === "lint")
    : steps;
}

function normalizeWorkspaceRelativePath(workspaceRoot: string, file: string): string | undefined {
  if (!file.trim() || /[\u0000-\u001f\u007f]/u.test(file)) return undefined;
  const absolutePath = resolve(isAbsolute(file) ? file : join(workspaceRoot, file));
  const workspaceRelative = relative(workspaceRoot, absolutePath);
  if (!workspaceRelative || workspaceRelative.startsWith("..") || isAbsolute(workspaceRelative)) {
    return undefined;
  }
  return workspaceRelative.replaceAll("\\", "/");
}

function isRootVerificationConfig(file: string): boolean {
  if (file.includes("/")) return false;
  return /^(?:package\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|vitest\.config\.[^.]+|tsconfig(?:\.[^.]+)?\.json)$/u.test(file);
}

async function pathResolvesWithinWorkspace(
  workspaceRoot: string,
  canonicalWorkspaceRoot: string,
  workspaceRelativePath: string,
): Promise<boolean> {
  let candidate = join(workspaceRoot, workspaceRelativePath);
  while (true) {
    const canonicalCandidate = await realpath(candidate).catch(() => undefined);
    if (canonicalCandidate) {
      return canonicalPathIsWithin(canonicalWorkspaceRoot, canonicalCandidate);
    }
    const parent = dirname(candidate);
    if (parent === candidate) return false;
    candidate = parent;
  }
}

function canonicalPathIsWithin(canonicalRoot: string, canonicalPath: string): boolean {
  const canonicalRelative = relative(canonicalRoot, canonicalPath);
  return canonicalRelative === "" || (!canonicalRelative.startsWith("..") && !isAbsolute(canonicalRelative));
}

async function findNearestPackageRoot(
  workspaceRoot: string,
  canonicalWorkspaceRoot: string,
  changedFile: string,
): Promise<string> {
  let candidate = dirname(join(workspaceRoot, changedFile));
  while (candidate !== workspaceRoot) {
    if (await fileExists(join(candidate, "package.json"))) {
      const canonicalPackageRoot = await realpath(candidate).catch(() => undefined);
      return canonicalPackageRoot && canonicalPathIsWithin(canonicalWorkspaceRoot, canonicalPackageRoot)
        ? candidate
        : workspaceRoot;
    }
    const parent = dirname(candidate);
    if (parent === candidate || relative(workspaceRoot, parent).startsWith("..")) break;
    candidate = parent;
  }
  return workspaceRoot;
}

async function findExactRootVitestTargets(
  workspaceRoot: string,
  canonicalWorkspaceRoot: string,
  changedFiles: string[],
): Promise<string[]> {
  const targets = new Set<string>();
  for (const changedFile of changedFiles) {
    const candidates = /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(changedFile)
      ? [changedFile]
      : changedFile.match(/\.[cm]?[jt]sx?$/u)
        ? [
            changedFile.replace(/(\.[cm]?[jt]sx?)$/u, ".test$1"),
            changedFile.replace(/(\.[cm]?[jt]sx?)$/u, ".spec$1"),
          ]
        : [];
    for (const candidate of candidates) {
      if (!/^[A-Za-z0-9_./-]+$/u.test(candidate)) continue;
      const normalized = normalizeWorkspaceRelativePath(workspaceRoot, candidate);
      if (
        normalized === candidate &&
        await fileExists(join(workspaceRoot, candidate)) &&
        await pathResolvesWithinWorkspace(workspaceRoot, canonicalWorkspaceRoot, candidate)
      ) {
        targets.add(candidate);
      }
    }
  }
  return [...targets].sort();
}

function deduplicateVerificationSteps(steps: VerificationStep[]): VerificationStep[] {
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = `${step.kind}\u0000${step.cwd ?? ""}\u0000${step.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createVerificationUnavailableReport(
  kind: "real-smoke" | "focused",
  reason: string,
): VerificationReport {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    status: "partial",
    summary: `PARTIAL：${kind} 未运行，未生成 PASS 证据。`,
    commands: [],
    unverified: [`${kind}: ${reason}`],
    risk: [`${kind} 缺少可执行入口；不得声称验证通过。`],
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    nextAction:
      kind === "real-smoke"
        ? "在 package.json 增加真实 smoke 脚本后运行 /verify real-smoke，或明确降级为 synthetic self-check。"
        : "补充项目验证脚本，或运行 /verify smoke 只做 runner self-check。",
  };
}

function createMetaOrchestrationVerificationBlockedReport(input: {
  id: string;
  startedAt: string;
  mode: "ask" | "stop";
  reason: string;
}): VerificationReport {
  const endedAt = new Date().toISOString();
  return {
    id: input.id,
    status: "partial",
    summary: `PARTIAL：中枢调度要求 verification ${input.mode}，验证未运行，未生成 PASS 证据。`,
    commands: [],
    unverified: [`verification ${input.mode}: ${input.reason}`],
    risk: ["Verification was blocked by meta orchestration; do not claim tests or checks passed."],
    startedAt: input.startedAt,
    endedAt,
    durationMs: Date.parse(endedAt) - Date.parse(input.startedAt),
    nextAction:
      input.mode === "ask"
        ? "先处理需要确认的中枢调度/权限边界，再重新运行验证。"
        : "先解除中枢 hard-stop 条件，再重新运行验证。",
  };
}

export function addPackageStep(
  steps: VerificationStep[],
  scripts: Record<string, unknown>,
  scriptName: string,
  kind: VerificationStepKind,
  reason: string,
  packageManager: PackageManager = "pnpm",
  cwd?: string,
): void {
  if (typeof scripts[scriptName] !== "string") {
    return;
  }
  steps.push({ kind, command: formatPackageManagerCommand(packageManager, scriptName), reason, cwd });
}

function createRealSmokePlan(
  scripts: Record<string, unknown>,
  packageManager: PackageManager,
): VerificationStep[] {
  if (typeof scripts.smoke === "string") {
    return [
      {
        kind: "smoke",
        command: formatPackageManagerCommand(packageManager, "smoke"),
        reason:
          "项目自定义 real-smoke：使用 package.json smoke 脚本；非 synthetic，可作为真实 smoke 候选证据。",
        synthetic: false,
      },
    ];
  }

  const candidates: Array<{ scriptName: string; reason: string }> = [
    {
      scriptName: "smoke:tui-stdin",
      reason:
        "项目 TUI stdin real-smoke：覆盖真实 CLI/TUI 输入主链；非 synthetic，可作为真实 smoke 候选证据。",
    },
    {
      scriptName: "smoke:live-provider",
      reason:
        "项目 live-provider real-smoke：覆盖真实 provider 请求主链；非 synthetic，可作为真实 provider smoke 候选证据。",
    },
  ];

  return candidates
    .filter((candidate) => typeof scripts[candidate.scriptName] === "string")
    .map((candidate) => ({
      kind: "smoke" as const,
      command: formatPackageManagerCommand(packageManager, candidate.scriptName),
      reason: candidate.reason,
      synthetic: false,
    }));
}

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

async function detectPackageManager(projectPath: string): Promise<PackageManager> {
  if (await fileExists(join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(join(projectPath, "package-lock.json"))) return "npm";
  if (await fileExists(join(projectPath, "yarn.lock"))) return "yarn";
  if (
    (await fileExists(join(projectPath, "bun.lockb"))) ||
    (await fileExists(join(projectPath, "bun.lock")))
  ) {
    return "bun";
  }
  return "pnpm";
}

function formatPackageManagerCommand(packageManager: PackageManager, scriptName: string): string {
  if (packageManager === "npm") return `npm run ${scriptName}`;
  if (packageManager === "yarn") return `corepack yarn ${scriptName}`;
  if (packageManager === "bun") return `bun run ${scriptName}`;
  return `corepack pnpm ${scriptName}`;
}

function formatTargetedTestCommand(packageManager: PackageManager, target: string): string {
  const command = formatPackageManagerCommand(packageManager, "test");
  return packageManager === "npm" ? `${command} -- ${target}` : `${command} ${target}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveVerificationScopeCwd(
  projectPath: string,
  changedFiles: string[],
): Promise<string> {
  const projectRoot = resolve(projectPath);
  if (changedFiles.length === 0) return projectRoot;
  const packageRoots = new Set<string>();
  for (const changedFile of changedFiles) {
    const filePath = resolve(isAbsolute(changedFile) ? changedFile : join(projectRoot, changedFile));
    const projectRelativePath = relative(projectRoot, filePath);
    if (projectRelativePath.startsWith("..") || isAbsolute(projectRelativePath)) return projectRoot;
    let candidate = dirname(filePath);
    while (true) {
      if (await fileExists(join(candidate, "package.json"))) {
        packageRoots.add(candidate);
        break;
      }
      if (candidate === projectRoot) {
        packageRoots.add(projectRoot);
        break;
      }
      const parent = dirname(candidate);
      if (parent === candidate || relative(projectRoot, parent).startsWith("..")) {
        packageRoots.add(projectRoot);
        break;
      }
      candidate = parent;
    }
    if (packageRoots.size > 1) return projectRoot;
  }
  return packageRoots.values().next().value ?? projectRoot;
}

export function getRequestScopedVerificationChangedFiles(context: TuiContext): string[] {
  if (context.currentRequestChangedFiles?.length) return [...context.currentRequestChangedFiles];
  if (context.currentRequestMentionedFiles?.length) return [...context.currentRequestMentionedFiles];
  if (context.currentRequestTurnId) return [];
  const lastChangedFile = context.tools.changedFiles.at(-1);
  return lastChangedFile ? [lastChangedFile] : [];
}

function createVerificationOwnerKey(
  sessionId: string,
  options: {
    ownerAgentId?: string;
    workflowRunId?: string;
    requestTurnId?: string;
  },
): string {
  if (options.ownerAgentId) return `agent:${sessionId}:${options.ownerAgentId}`;
  if (options.workflowRunId) return `workflow:${sessionId}:${options.workflowRunId}`;
  if (options.requestTurnId) return `request:${sessionId}:${options.requestTurnId}`;
  return `session:${sessionId}`;
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
  options: {
    cwd?: string;
    ownerAgentId?: string;
    ownerSessionId?: string;
    ownerSignal?: AbortSignal;
    workflowRunId?: string;
    requestTurnId?: string;
    changedFiles?: string[];
    level?: string;
    heartbeatIntervalMs?: number;
    staleAfterMs?: number;
    commitGuard?: () => boolean;
    permissionMode?: PermissionMode;
    userActionConstraints?: UserActionConstraints;
    originalTask?: string;
    targetPackage?: string;
  } = {},
): Promise<VerificationReport> {
  const runId = randomUUID();
  const ownerSessionId = options.ownerSessionId ?? sessionId;
  const cwd = resolve(options.cwd ?? context.projectPath);
  const ownerKey = createVerificationOwnerKey(ownerSessionId, options);
  const scope: VerificationScope = {
    ownerKey,
    cwd,
    changedFiles: [...(options.changedFiles ?? [])],
    ownerSessionId,
    ...(options.ownerAgentId ? { ownerAgentId: options.ownerAgentId } : {}),
    ...(options.workflowRunId ? { workflowRunId: options.workflowRunId } : {}),
    ...(options.requestTurnId ? { requestTurnId: options.requestTurnId } : {}),
    ...(options.level ? { level: options.level } : {}),
    ...(options.originalTask ? { originalTask: options.originalTask } : {}),
    ...(options.targetPackage ? { targetPackage: options.targetPackage } : {}),
  };
  const startedAt = new Date().toISOString();
  const orchestration = resolveMetaOrchestrationAction(context, "verification");
  await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
    stepId: "verification",
    executor: "verification-runtime",
    status: "consumed",
    summary: `mode=${orchestration.mode}; requestedSteps=${plan.length}`,
    level: orchestration.shouldRun ? "info" : "warning",
  });
  if (orchestration.shouldStop || orchestration.shouldAsk) {
    const report = createMetaOrchestrationVerificationBlockedReport({
      id: runId,
      startedAt,
      mode: orchestration.shouldAsk ? "ask" : "stop",
      reason: orchestration.reason,
    });
    report.scope = scope;
    await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
      stepId: "verification",
      executor: "verification-runtime",
      status: "blocked",
      summary: `mode=${orchestration.mode}; reason=${orchestration.reason}`,
      level: "warning",
    });
    writeLine(output, report.summary);
    context.latestVerificationRunId = runId;
    context.latestVerificationRunIds ??= new Map();
    context.latestVerificationRunIds.set(ownerKey, runId);
    return report;
  }
  const skippedByUserConstraint = plan.flatMap((step) => {
    const reason = verificationStepConstraintReason(options.userActionConstraints, step.kind);
    return reason ? [{ step, reason }] : [];
  });
  const effectivePlan = plan.filter(
    (step) => verificationStepConstraintReason(options.userActionConstraints, step.kind) === undefined,
  );
  if (options.permissionMode) {
    for (const step of effectivePlan) {
      const permission = await decidePermission(
        "Bash",
        { command: step.command },
        context,
        sessionId,
        {
          permissionMode: options.permissionMode,
          userActionConstraints: options.userActionConstraints,
        },
      );
      if (options.commitGuard?.() === false || options.ownerSignal?.aborted === true) {
        const endedAt = new Date().toISOString();
        context.latestVerificationRunId = runId;
        context.latestVerificationRunIds ??= new Map();
        context.latestVerificationRunIds.set(ownerKey, runId);
        return {
          id: runId,
          status: "stale",
          summary: "STALE：验证命令在权限检查期间失去 owner，未生成 PASS 证据。",
          commands: [],
          unverified: [`${step.kind}: owner changed before Bash permission commit`],
          risk: ["Verification permission result was discarded before command execution."],
          startedAt,
          endedAt,
          durationMs: Date.parse(endedAt) - Date.parse(startedAt),
          nextAction: "确认当前请求 owner 后重新发起验证。",
          scope,
        };
      }
      if (permission.decision !== "allow") {
        const endedAt = new Date().toISOString();
        context.latestVerificationRunId = runId;
        context.latestVerificationRunIds ??= new Map();
        context.latestVerificationRunIds.set(ownerKey, runId);
        return {
          id: runId,
          status: "partial",
          summary: `PARTIAL：验证命令需要 Bash 权限（${permission.decision}），未执行且未生成 PASS 证据。`,
          commands: [],
          unverified: [`${step.kind}: Bash permission ${permission.decision}: ${permission.reason}`],
          risk: ["Verification command did not pass the existing Bash permission boundary."],
          startedAt,
          endedAt,
          durationMs: Date.parse(endedAt) - Date.parse(startedAt),
          nextAction:
            permission.decision === "ask"
              ? "通过现有 Bash 权限确认后重新运行验证，或显式使用 /verify。"
              : "解除当前 Bash 权限或用户约束后重新运行验证。",
          scope,
        };
      }
    }
  }
  const skippedByDegrade = 0;
  const logRoot = join(
    resolveStoragePaths(context.config, context.projectPath).logs,
    "verification",
  );
  await mkdir(logRoot, { recursive: true });
  context.latestVerificationRunId = runId;
  context.latestVerificationRunIds ??= new Map();
  context.latestVerificationRunIds.set(ownerKey, runId);
  const controller = new AbortController();
  context.activeVerificationAbortControllers ??= new Map();
  context.activeVerificationAbortControllers.set(runId, controller);
  const abortFromOwner = () => controller.abort();
  if (options.ownerSignal?.aborted) {
    controller.abort();
  } else {
    options.ownerSignal?.addEventListener("abort", abortFromOwner, { once: true });
  }
  const task: BackgroundTaskState = {
    id: runId,
    kind: "verification",
    ownerSessionId,
    ...(options.ownerAgentId ? { ownerAgentId: options.ownerAgentId } : {}),
    ...(options.requestTurnId ? { requestTurnId: options.requestTurnId } : {}),
    ...(options.workflowRunId ? { workflowRunId: options.workflowRunId } : {}),
    title: "Verification Runner",
    status: "running",
    currentStep: "preparing verification",
    progress: { completed: 0, total: effectivePlan.length, label: "verify" },
    startedAt,
    updatedAt: startedAt,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 30_000,
    staleAfterMs: options.staleAfterMs ?? 120_000,
    logPath: logRoot,
    hasOutput: false,
    userVisibleSummary: `验证已启动：${effectivePlan.length} 个步骤。可用 /background 查看详情。`,
    nextAction: "等待 PASS / FAIL / PARTIAL 结果，失败后按建议修复并复跑 /verify。",
  };
  rememberBackgroundTask(context, task);
  const results: VerificationCommandResult[] = [];
  const unverified: string[] = [
    ...new Set(effectivePlan.map((step) => step.coverageGap).filter((gap): gap is string => Boolean(gap))),
    ...skippedByUserConstraint.map(
      ({ step, reason }) => `${step.kind} skipped by current user constraint: ${reason}`,
    ),
    ...(effectivePlan.length === 0 ? ["verification plan contained no executable steps"] : []),
    ...(skippedByDegrade > 0
      ? [`meta orchestration degrade skipped ${skippedByDegrade} verification step(s): ${orchestration.reason}`]
      : []),
  ];
  const risk: string[] = [
    ...(skippedByUserConstraint.length > 0
      ? ["Verification steps filtered by the current user request cannot support a full PASS."]
      : []),
    ...(skippedByDegrade > 0
      ? ["Verification was degraded by meta orchestration; do not claim full verification PASS."]
      : []),
  ];
  let report: VerificationReport | undefined;
  try {
    await context.store.appendEvent(sessionId, {
      type: "verification_start",
      run: { id: runId, plan: effectivePlan, startedAt },
      createdAt: startedAt,
    });
    await appendBackgroundTaskEvent(context, sessionId, task);
    await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
      stepId: "verification",
      executor: "verification-runtime",
      status: "consumed",
      summary: `mode=${orchestration.mode}; run=${runId}; steps=${effectivePlan.length}; skipped=${skippedByDegrade}`,
    });
    writeLine(output, formatBackgroundTask(task, context.language));

    for (const [index, step] of effectivePlan.entries()) {
      const stepStarted = Date.now();
      task.currentStep = `${step.kind} ${index + 1}/${effectivePlan.length}`;
      task.progress = { completed: index, total: effectivePlan.length, label: step.kind };
      task.updatedAt = new Date().toISOString();
      await appendBackgroundTaskEvent(context, sessionId, task);
      writeLine(output, `验证步骤：${task.currentStep} · ${step.command}`);

      const logPath = join(logRoot, `${runId}-${index + 1}-${step.kind}.log`);
      const heartbeat = setInterval(() => {
        if (task.status !== "running" || controller.signal.aborted) return;
        task.updatedAt = new Date().toISOString();
        void appendBackgroundTaskEvent(context, sessionId, task).catch(() => undefined);
      }, task.heartbeatIntervalMs);
      const stepCwd = resolve(step.cwd ?? cwd);
      const result = await runVerificationCommand(step.command, stepCwd, controller.signal).finally(
        () => clearInterval(heartbeat),
      );
      const durationMs = Date.now() - stepStarted;
      const runnerErrorLine = result.runnerError ? `runner error ${result.runnerError}\n` : "";
      const fullLog = `$ ${step.command}\nexit code ${result.exitCode}\noutcome ${result.outcome}\n${runnerErrorLine}duration ${durationMs}ms\n\n${result.output}`;
      await writeFile(logPath, fullLog, "utf8");
      const summary = summarizeVerificationOutput(
        result.output,
        result.exitCode,
        result.runnerError,
      );
      const wasCancelled = controller.signal.aborted || task.status === "cancelled";
      const wasMarkedStale = task.status === "stale";
      const commandStatus: VerificationRuntimeStatus =
        wasCancelled || result.outcome === "cancelled"
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
    let status: VerificationReport["status"] =
      results.length === 0
        ? "partial"
        : cancelled.length > 0
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
    const syntheticOnlyPass =
      status === "pass" && results.every((item) => item.synthetic === true || item.status !== "pass");
    if (syntheticOnlyPass) {
      status = "partial";
      unverified.push("synthetic self-check passed, but real verification did not run");
      risk.push("Synthetic self-check success cannot support a verification PASS claim.");
    }
    report = {
      id: runId,
      status,
      summary:
        syntheticOnlyPass
          ? "PARTIAL：synthetic self-check 已通过；真实验证未运行，不能作为真实 PASS 证据。"
          : status === "pass"
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
        syntheticOnlyPass
          ? "补充并运行真实 focused/smoke/test 验证后再声明 PASS。"
          : status === "pass"
          ? "可继续审查结果或进入交付总结。"
          : hasRunnerError
            ? "查看 runner error 日志，记录 Node 版本，并建议用 Node 22 LTS 复核。"
            : "先查看失败命令与日志，修复后复跑 /verify。",
      scope,
    };
    return report;
  } catch (error) {
    const endedAt = new Date().toISOString();
    const ownerStale =
      options.commitGuard?.() === false ||
      context.latestVerificationRunIds?.get(ownerKey) !== runId;
    const status: VerificationReport["status"] = controller.signal.aborted
      ? "cancelled"
      : ownerStale
        ? "stale"
        : "partial";
    const message = error instanceof Error ? error.message : String(error);
    report = {
      id: runId,
      status,
      summary:
        status === "cancelled"
          ? "CANCELLED：验证在异常处理期间被取消，未生成 PASS 证据。"
          : status === "stale"
            ? "STALE：验证在异常处理期间失去 owner，未生成 PASS 证据。"
            : "PARTIAL：验证运行时发生异常，未生成 PASS 证据。",
      commands: results,
      unverified: [...unverified, `verification runtime error: ${message}`],
      risk: [...risk, "Verification runtime did not reach a clean terminal persist."],
      logPath: logRoot,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      nextAction: "查看 verification runtime 错误并复跑最小验证。",
      scope,
    };
    return report;
  } finally {
    if (!report) {
      const endedAt = new Date().toISOString();
      report = {
        id: runId,
        status: controller.signal.aborted ? "cancelled" : "partial",
        summary: controller.signal.aborted
          ? "CANCELLED：验证已取消，未生成 PASS 证据。"
          : "PARTIAL：验证未形成终态报告，未生成 PASS 证据。",
        commands: results,
        unverified: [...unverified, "verification finalizer created a fallback terminal report"],
        risk: [...risk, "Verification did not produce a normal terminal report."],
        logPath: logRoot,
        startedAt,
        endedAt,
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        nextAction: "查看 verification runtime 日志并复跑最小验证。",
        scope,
      };
    }
    const passCommitStillValid = (): boolean =>
      !controller.signal.aborted &&
      options.commitGuard?.() !== false &&
      context.latestVerificationRunIds?.get(ownerKey) === runId;
    if (report.status === "pass" && !passCommitStillValid()) {
      report.status = controller.signal.aborted ? "cancelled" : "stale";
      report.summary = controller.signal.aborted
        ? "CANCELLED：验证在提交 PASS 前已取消，未生成 PASS 证据。"
        : "STALE：验证在提交 PASS 前失去 owner，未生成 PASS 证据。";
      report.unverified.push(`${report.status}: owner changed before PASS commit.`);
      report.risk.push("Verification PASS was discarded before commit.");
    }
    task.status =
      report.status === "fail"
        ? "failed"
        : report.status === "cancelled" || report.status === "timeout" || report.status === "stale"
          ? report.status
          : "completed";
    task.result = report.status;
    task.currentStep = report.status === "pass" ? "verification finished" : `verification ${report.status}`;
    task.progress = { completed: results.length, total: effectivePlan.length, label: "verify" };
    task.updatedAt = report.endedAt;
    task.nextAction = report.nextAction;
    task.userVisibleSummary = report.summary;
    let terminalTaskPersisted = true;
    await appendBackgroundTaskEvent(context, sessionId, task).catch((error) => {
      terminalTaskPersisted = false;
      report!.risk.push(`verification task terminal persist failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    let reportChangedAfterTaskPersist = false;
    await context.store.appendEvent(sessionId, {
      type: "verification_end",
      report,
      createdAt: report.endedAt,
    }, report.status === "pass" ? passCommitStillValid : undefined).catch((error) => {
      if (report!.status === "pass") {
        report!.status = "partial";
        report!.summary = "PARTIAL：验证命令通过，但终态证据持久化失败，不能作为 PASS 证据。";
        report!.unverified.push("verification terminal evidence was not persisted");
        reportChangedAfterTaskPersist = true;
      }
      report!.risk.push(`verification end persist failed: ${error instanceof Error ? error.message : String(error)}`);
      task.status = "completed";
      task.result = report!.status;
      task.currentStep = `verification ${report!.status}`;
      task.userVisibleSummary = report!.summary;
    });
    if (reportChangedAfterTaskPersist) {
      await context.store.appendEvent(sessionId, {
        type: "verification_end",
        report,
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        report!.risk.push(`verification end retry failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    if (!terminalTaskPersisted || reportChangedAfterTaskPersist) {
      await appendBackgroundTaskEvent(context, sessionId, task).catch((error) => {
        report!.risk.push(`verification task terminal retry failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    if (report.status === "pass" && !passCommitStillValid()) {
      report.status = controller.signal.aborted ? "cancelled" : "stale";
      report.summary = controller.signal.aborted
        ? "CANCELLED：验证在提交 PASS 时已取消，未生成 PASS 证据。"
        : "STALE：验证在提交 PASS 时失去 owner，未生成 PASS 证据。";
      report.unverified.push(`${report.status}: owner changed during PASS commit.`);
      report.risk.push("Verification PASS was discarded during commit.");
      task.status = report.status;
      task.result = report.status;
      task.currentStep = `verification ${report.status}`;
      task.userVisibleSummary = report.summary;
      await appendBackgroundTaskEvent(context, sessionId, task).catch(() => undefined);
      await context.store.appendEvent(sessionId, {
        type: "verification_end",
        report,
        createdAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
    await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
      stepId: "verification",
      executor: "verification-runtime",
      status: report.status === "pass" ? "completed" : report.status === "fail" ? "failed" : "degraded",
      summary: `${report.status}; run=${runId}; commands=${results.length}; unverified=${report.unverified.length}`,
      level: report.status === "pass" ? "info" : "warning",
    }).catch(() => undefined);
    options.ownerSignal?.removeEventListener("abort", abortFromOwner);
    if (context.activeVerificationAbortControllers?.get(runId) === controller) {
      context.activeVerificationAbortControllers.delete(runId);
    }
  }
}

export function isCurrentVerificationReport(
  context: TuiContext,
  report: VerificationReport,
): boolean {
  const currentRunId = report.scope
    ? context.latestVerificationRunIds?.get(report.scope.ownerKey)
    : context.latestVerificationRunId;
  return (
    currentRunId === report.id &&
    report.status !== "cancelled" &&
    report.status !== "stale"
  );
}

export async function runVerificationCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = LINGHUN_VERIFICATION_COMMAND_TIMEOUT_MS,
): Promise<{
  exitCode: number;
  output: string;
  outcome: "completed" | "timeout" | "cancelled";
  runnerError?: string;
}> {
  if (signal?.aborted) {
    return {
      exitCode: 1,
      output: "",
      outcome: "cancelled",
      runnerError: "runner cancelled before spawn",
    };
  }
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
  return formatVerificationReportLines(report, language, true).join("\n");
}

export function formatVerificationTaskSummary(
  report: VerificationReport,
  language: Language,
): string {
  return formatVerificationReportLines(report, language, false).join("\n");
}

function formatVerificationReportLines(
  report: VerificationReport,
  language: Language,
  includeCommandDetails: boolean,
): string[] {
  const statusLabel = report.status.toUpperCase();
  const statusAlreadyShown = new RegExp(`^${statusLabel}(?:\\s|:|：)`, "u").test(report.summary);
  const summary = statusAlreadyShown ? report.summary : `${statusLabel} ${report.summary}`;
  const syntheticOnlyPass =
    report.status === "pass" &&
    report.commands.length > 0 &&
    report.commands.every((command) => command.synthetic === true || command.status !== "pass");
  const lines = [
    summary,
    language === "en-US" ? `Duration: ${report.durationMs}ms` : `耗时：${report.durationMs}ms`,
  ];
  if (syntheticOnlyPass) {
    lines.push(
      language === "en-US"
        ? "Real verification did not run; this is not enough evidence for a real PASS."
        : "真实验证未运行；这不足以证明真实 PASS。",
    );
  }
  if (includeCommandDetails) {
    for (const command of report.commands) {
      lines.push(
        `- [${command.status.toUpperCase()}] ${command.command} (${command.durationMs}ms) log: ${command.logPath ?? "无日志"}`,
      );
      if (command.status !== "pass") {
        lines.push(`  摘要：${command.summary}`);
      }
    }
  }
  // R1: task summary no longer exposes raw log paths on main screen.
  // Full paths remain visible in /verify last (includeCommandDetails=true).
  if (includeCommandDetails && report.unverified.length > 0) {
    lines.push(`未验证：${report.unverified.join("; ")}`);
  }
  lines.push(`下一步：${report.nextAction}`);
  if (!includeCommandDetails) {
    lines.push(language === "en-US" ? "Details: /verify last" : "详情：/verify last");
  }
  return lines;
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
    ? `exit code ${exitCode}; runner error ${runnerError}; ${summary}`
    : `exit code ${exitCode}; ${summary}`;
}

export async function safeReadJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
