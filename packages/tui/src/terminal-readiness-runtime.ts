import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TuiContext } from "./index.js";
import { formatCooldownDoctorLine } from "./provider-circuit-breaker.js";
import { classifyRuntimePath, classifyStartupPath } from "./runtime-path-marker.js";
import type { TerminalProblemView, TerminalReadinessView } from "./terminal-readiness-presenter.js";
import { getSelectedModelRuntime } from "./tui-model-runtime.js";
import { classifyVerificationLevel } from "./verification-level.js";
import { isFallbackWorkspaceReferenceSnapshot } from "./workspace-reference-cache.js";

export function createTerminalReadinessView(context: TuiContext): TerminalReadinessView {
  const runtime = getSelectedModelRuntime(context);
  const latestCache = context.cache.history.at(-1);
  const blockedBackground = context.backgroundTasks.filter((task) =>
    ["failed", "cancelled", "timeout", "stale"].includes(task.status),
  );
  const webSourceEvidence = context.evidence.some((evidence) => evidence.kind === "web_source")
    ? "present"
    : "missing";
  const projectDoctor = createProjectDoctorLite(context);
  const sourceDrift = createSourceOfTruthDriftLite(context);
  const contextPicker = createContextPickerLite(context, webSourceEvidence);
  const rollbackCoach = createRollbackCoachLite(context);
  const costPreview = createTaskCostPreviewLite(context);
  return {
    projectPath: context.projectPath,
    provider: runtime.provider,
    model: runtime.model,
    endpointProfile: runtime.endpointProfile,
    // D.14A-R-Fix P1-5 — 只有本会话观察到真实 provider usage（cache history 有记录）
    // 才算 live-verified；仅配置存在不算 provider 可用。lastProviderFailure 时不算
    // live-verified，由 providerFailure 分支接管为 fail。
    providerLiveVerified: context.cache.history.length > 0 && !context.lastProviderFailure,
    permissionMode: context.permissionMode,
    language: context.language,
    index: {
      status: context.index.status,
      changedFiles: context.index.changedFiles ?? null,
      staleHint: context.index.staleHint,
    },
    cache: {
      latestHitRate: latestCache?.hitRate ?? null,
      compacted: context.cache.compacted,
      // D.13V — fallback snapshot 不再当 ready；区分 ready / stale-fallback / missing。
      workspaceSnapshot: (() => {
        const latest = context.cache.workspaceReference.latest;
        if (!latest?.workspaceSnapshot) return "missing";
        if (isFallbackWorkspaceReferenceSnapshot(latest)) return "stale-fallback";
        return "ready";
      })(),
    },
    memory: {
      projectRules: context.memory.projectRulesError
        ? "unreadable"
        : context.memory.projectRulesExists
          ? "found"
          : "missing",
      candidates: context.memory.candidates.length,
      accepted: context.memory.accepted.length,
    },
    mcp: {
      enabled: context.mcp.enabled,
      servers: context.mcp.servers.length,
      tools: context.mcp.tools.length,
      errors: context.mcp.servers.filter((server) => server.status === "error").length,
    },
    background: {
      total: context.backgroundTasks.length,
      running: context.backgroundTasks.filter((task) => task.status === "running").length,
      blocked: blockedBackground.length,
    },
    verification: context.lastVerification
      ? {
          status: context.lastVerification.status,
          summary: context.lastVerification.summary,
          unverified: context.lastVerification.unverified.length,
          risk: context.lastVerification.risk.length,
        }
      : undefined,
    providerFailure: context.lastProviderFailure
      ? {
          code: context.lastProviderFailure.code,
          provider: context.lastProviderFailure.provider,
          model: context.lastProviderFailure.model,
          endpointProfile: context.lastProviderFailure.endpointProfile,
          summary: context.lastProviderFailure.summary,
        }
      : undefined,
    freshness: { webSourceEvidence },
    runtimePath: createRuntimePathForReadiness(context),
    verificationLevel: createVerificationLevelForReadiness(context),
    startupPath: createStartupPathForReadiness(),
    projectDoctor,
    sourceDrift,
    contextPicker,
    rollbackCoach,
    costPreview,
    problems: createTerminalProblems(context, webSourceEvidence, {
      projectDoctor,
      sourceDrift,
      contextPicker,
      rollbackCoach,
      costPreview,
    }),
  };
}

function createRuntimePathForReadiness(_context: TuiContext): TerminalReadinessView["runtimePath"] {
  const isTTY = Boolean(process.stdout.isTTY);
  const isCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI);
  const envOverride = process.env.LINGHUN_TUI_RENDER_MODE;
  const forcedLegacy = envOverride === "legacy";
  const inkAvailable = isTTY && !isCI && !forcedLegacy;
  const marker = classifyRuntimePath({
    isTTY,
    inkAvailable,
    envOverride,
    forcedLegacy,
    isCI,
  });
  return {
    path: marker.path,
    kind: marker.kind,
    canClaimMature: marker.canClaimMature,
    degradedReason: marker.degradedReason,
  };
}

export function createVerificationLevelForReadiness(
  context: TuiContext,
): NonNullable<TerminalReadinessView["verificationLevel"]> {
  const lastVerification = context.lastVerification;
  if (!lastVerification) {
    return {
      level: "source",
      canClaimPass: false,
      canClaimMature: false,
      upgradeBlocked: false,
    };
  }
  // D.13V P0-3 — 走 verification-level.ts 的统一分级器，不再用
  // `status === "pass" && unverified.length === 0` 直升 real-smoke。
  //
  // 分级器入参从 VerificationReport 推导：
  //   - realProcessObserved：仅当报告里**有 smoke kind 的命令且该命令 pass**
  //     才算真实拉起进程观察过；只跑了 vitest/tsc/build 不算 real-smoke。
  //   - simulatedOrPartial / fallbackUsed：任何 partial/stale/cancelled/timeout/
  //     skipped 命令、unverified 列表非空、status=partial、status=stale、或
  //     runnerError 都触发降级（分级器内部会 cap 到 mock）。
  //   - buildPassed：status=pass 且没有降级因子。
  //   - localTestRunner：有 test kind 命令。
  // 目的是让 readiness 不再绕过 verification-level.ts 的真实证据要求，build
  // 通过即报 real-smoke 的 false positive 在分级器入口被拒。
  const status = lastVerification.status;
  const commands = lastVerification.commands ?? [];
  const hasRunnerError = commands.some((c) => Boolean(c.runnerError));
  const hasPartialOrSkipped = commands.some(
    (c) =>
      c.status === "partial" ||
      c.status === "skipped" ||
      c.status === "stale" ||
      c.status === "cancelled" ||
      c.status === "timeout",
  );
  const hasFailedCommand = commands.some((c) => c.status === "fail");
  // D.14A-R-Fix P1-2 — 只有**非合成** smoke kind 命令 pass 才算真实拉起进程观察过。
  // `/verify smoke` 的合成 node smoke（synthetic=true）只证明本地 Node 进程可运行，
  // 不是真实 provider/TUI/render/report 主链 smoke，不能升级为 real-smoke。
  const smokePassed = commands.some(
    (c) => c.kind === "smoke" && c.status === "pass" && c.synthetic !== true,
  );
  const realProcessObserved =
    status === "pass" &&
    smokePassed &&
    !hasRunnerError &&
    !hasPartialOrSkipped &&
    !hasFailedCommand &&
    lastVerification.unverified.length === 0;
  const simulatedOrPartial =
    status === "partial" || lastVerification.unverified.length > 0 || hasPartialOrSkipped;
  const fallbackUsed = hasRunnerError || status === "stale";
  const buildPassed = status === "pass" && !simulatedOrPartial && !fallbackUsed;
  const localTestRunner = commands.some((c) => c.kind === "test");
  const classification = classifyVerificationLevel({
    realProcessObserved,
    simulatedOrPartial,
    fallbackUsed,
    buildPassed,
    localTestRunner,
  });
  return {
    level: classification.level,
    canClaimPass: classification.canClaimPass,
    canClaimMature: classification.canClaimMature,
    upgradeBlocked: classification.upgradeBlocked,
    blockReason: classification.blockReason,
  };
}

function createStartupPathForReadiness(): TerminalReadinessView["startupPath"] {
  const isSourceExecution = Boolean(
    process.argv[1]?.endsWith(".ts") || process.env.LINGHUN_DEV_MODE || process.env.VITEST,
  );
  const isDistExecution = Boolean(
    process.argv[1]?.includes("/dist/") || process.argv[1]?.includes("\\dist\\"),
  );
  const isGlobalBin = Boolean(
    process.argv[1]?.includes("/bin/") || process.argv[1]?.includes("\\bin\\"),
  );
  const marker = classifyStartupPath({
    isSourceExecution,
    isDistExecution,
    isGlobalBin,
  });
  return {
    entryKind: marker.entryKind,
    isVerifiedCurrent: marker.isVerifiedCurrent,
    staleRisk: marker.staleRisk,
    staleReason: marker.staleReason,
  };
}

function createProjectDoctorLite(context: TuiContext): TerminalReadinessView["projectDoctor"] {
  const packageJson = readPackageJsonLite(context.projectPath);
  const scriptsRecord = readRecord(packageJson?.scripts);
  const scripts = Object.keys(scriptsRecord).sort();
  const packageManager = readPackageManagerLite(packageJson, context.projectPath);
  const configFiles = [
    "package.json",
    "tsconfig.json",
    "vitest.config.ts",
    "vitest.config.mts",
    "vitest.config.js",
    "vitest.config.mjs",
    "biome.json",
    "biome.jsonc",
    "pnpm-lock.yaml",
  ].filter((file) => existsSync(join(context.projectPath, file)));
  const ciFiles = [".github/workflows/ci.yml", ".github/workflows/ci.yaml"].filter((file) =>
    existsSync(join(context.projectPath, file)),
  );
  const packageManagerReady =
    packageManager.startsWith("pnpm@") ||
    (packageManager === "pnpm" && existsSync(join(context.projectPath, "pnpm-lock.yaml")));
  const vitestReady =
    hasAnyFile(context.projectPath, [
      "vitest.config.ts",
      "vitest.config.mts",
      "vitest.config.js",
      "vitest.config.mjs",
    ]) || hasPackageDependency(packageJson, "vitest");
  const biomeReady =
    hasAnyFile(context.projectPath, ["biome.json", "biome.jsonc"]) ||
    hasPackageDependency(packageJson, "@biomejs/biome");
  const projectRulesExists =
    context.memory.projectRulesExists || existsSync(join(context.projectPath, "LINGHUN.md"));
  const requiredChecks = [
    { id: "script:test", ok: typeof scriptsRecord.test === "string" },
    { id: "script:typecheck", ok: typeof scriptsRecord.typecheck === "string" },
    { id: "script:check", ok: typeof scriptsRecord.check === "string" },
    { id: "script:build", ok: typeof scriptsRecord.build === "string" },
    { id: "tsconfig", ok: existsSync(join(context.projectPath, "tsconfig.json")) },
    { id: "vitest", ok: vitestReady },
    { id: "biome", ok: biomeReady },
    { id: "pnpm/corepack", ok: packageManagerReady },
    { id: "ci-workflow", ok: ciFiles.length > 0 },
    { id: "LINGHUN.md", ok: projectRulesExists },
  ];
  const unknown = [
    packageJson ? undefined : "package.json",
    context.memory.projectRulesError ? "LINGHUN.md:unreadable" : undefined,
    ...requiredChecks.filter((check) => !check.ok).map((check) => check.id),
  ].filter((item): item is string => Boolean(item));
  const status: TerminalReadinessView["projectDoctor"]["status"] =
    unknown.length === 0 ? "pass" : "partial";
  return {
    status,
    packageManager,
    scripts,
    configFiles,
    ciFiles,
    projectRules: context.memory.projectRulesError
      ? "unreadable"
      : projectRulesExists
        ? "found"
        : "missing",
    checks: requiredChecks.map((check) => `${check.id}=${check.ok ? "ok" : "missing"}`),
    unknown,
  };
}

function createSourceOfTruthDriftLite(context: TuiContext): TerminalReadinessView["sourceDrift"] {
  const requiredDocs = [
    "docs/delivery/pre-open-source-terminal-product-completion-gate.md",
    "LINGHUN_PHASED_DELIVERY_BLUEPRINT.md",
    "LINGHUN_IMPLEMENTATION_SPEC.md",
    "docs/delivery/phase-15-5a-performance-context.md",
    "docs/delivery/phase-15-5b-resource-task-lifecycle.md",
    "docs/delivery/phase-15-5c-editing-tool-ux.md",
    "docs/delivery/phase-15-5c-plus-log-artifact-runtime-lite.md",
    "docs/delivery/phase-15-5c-plus-plus-workspace-snapshot-lite.md",
    "docs/delivery/phase-15-5d-connect-lite.md",
    "docs/delivery/phase-15-5e-provider-freshness.md",
    "docs/delivery/phase-15-5f-terminal-product-readiness.md",
  ];
  const checked = requiredDocs.filter((file) => existsSync(join(context.projectPath, file)));
  const issues = requiredDocs
    .filter((file) => !checked.includes(file))
    .map((file) => `missing:${file}`);
  const report = readTextFileLite(
    join(context.projectPath, "docs/delivery/phase-15-5f-terminal-product-readiness.md"),
  );
  if (report && !report.includes("Project Doctor Lite")) issues.push("report:project-doctor-lite");
  if (report && !report.includes("Source-of-Truth Drift")) issues.push("report:drift-linter-lite");
  if (report && !/未执行真实|未.*真实.*smoke|不代表真实全量 smoke/u.test(report)) {
    issues.push("report:no-real-smoke-negative");
  }
  if (report && !/不代表 Beta PASS|不是 Beta PASS|不声明 Beta PASS/u.test(report)) {
    issues.push("report:no-beta-ready-negative");
  }
  if (report && !/不代表.*smoke-ready|不是.*smoke-ready|不声明.*smoke-ready/u.test(report)) {
    issues.push("report:no-smoke-ready-negative");
  }
  if (
    report &&
    !/不代表.*open-source-ready|不是.*open-source-ready|不声明.*open-source-ready/u.test(report)
  ) {
    issues.push("report:no-open-source-ready-negative");
  }
  if (
    report &&
    !/未进入 Phase 16 \/ 17 \/ 18|未进 16\/17\/18|不得自动进入真实全量 smoke、Phase 16\/17\/18/u.test(
      report,
    )
  ) {
    issues.push("report:no-phase-16-17-18-negative");
  }
  if (report && !/未 commit|未提交 commit|不提交 commit|no commit/u.test(report)) {
    issues.push("report:no-commit-negative");
  }
  const status: TerminalReadinessView["sourceDrift"]["status"] =
    issues.length === 0 ? "pass" : checked.length > 0 ? "partial" : "unknown";
  return {
    status,
    checked,
    issues,
    nextAction:
      issues.length === 0 ? "/doctor report" : "sync Phase 15.5F report/source-of-truth notes",
  };
}

function createContextPickerLite(
  context: TuiContext,
  webSourceEvidence: "present" | "missing",
): TerminalReadinessView["contextPicker"] {
  // D.13V — fallback workspace snapshot 不再算 hasWorkspaceSnapshot。
  const wsLatest = context.cache.workspaceReference.latest;
  const hasWorkspaceSnapshot =
    Boolean(wsLatest?.workspaceSnapshot) && !isFallbackWorkspaceReferenceSnapshot(wsLatest);
  const refs = [
    context.memory.projectRulesExists ? "project-rules" : undefined,
    hasWorkspaceSnapshot ? "workspace-snapshot" : undefined,
    context.index.status !== "missing" ? "index-status" : undefined,
    context.lastVerification ? "verification-last" : undefined,
    context.backgroundTasks.length > 0 ? "background-tasks" : undefined,
    webSourceEvidence === "present" ? "web-source-evidence" : undefined,
  ].filter((item): item is string => Boolean(item));
  const evidenceKinds = [...new Set(context.evidence.map((evidence) => evidence.kind))].sort();
  const indexFreshness =
    context.index.status === "ready"
      ? "fresh"
      : context.index.status === "stale"
        ? "stale"
        : "unknown";
  const hasEvidenceRef = evidenceKinds.length > 0 || Boolean(context.lastVerification);
  const status: TerminalReadinessView["contextPicker"]["status"] =
    context.memory.projectRulesExists &&
    indexFreshness === "fresh" &&
    hasWorkspaceSnapshot &&
    hasEvidenceRef
      ? "pass"
      : refs.length > 0
        ? "partial"
        : "unknown";
  return {
    status,
    refs,
    evidenceKinds,
    indexFreshness,
  };
}

function createRollbackCoachLite(context: TuiContext): TerminalReadinessView["rollbackCoach"] {
  const gitStatusLines = readGitStatusShortLite(context.projectPath);
  const fallbackChangedFiles = new Set([
    ...context.tools.changedFiles,
    ...context.checkpoints.flatMap((checkpoint) => checkpoint.changedFiles),
  ]);
  const changedFiles = gitStatusLines ? gitStatusLines.length : fallbackChangedFiles.size;
  const untrackedFiles = gitStatusLines
    ? gitStatusLines.filter((line) => line.startsWith("??")).length
    : 0;
  const gitStatus = gitStatusLines
    ? gitStatusLines.length > 0
      ? "dirty"
      : "clean"
    : "unavailable";
  const hasBlockedWork = context.backgroundTasks.some((task) =>
    ["failed", "cancelled", "timeout", "stale"].includes(task.status),
  );
  const status: TerminalReadinessView["rollbackCoach"]["status"] =
    gitStatus === "unavailable"
      ? "unknown"
      : hasBlockedWork || changedFiles > 0
        ? "partial"
        : "pass";
  return {
    status,
    changedFiles,
    untrackedFiles,
    checkpoints: context.checkpoints.length,
    gitStatus,
    mode: "advisory-only",
    nextAction:
      changedFiles > 0
        ? "review /diff and create a normal checkpoint before manual rollback"
        : gitStatus === "unavailable"
          ? "run git status --short manually before rollback decisions"
          : "no rollback action suggested",
  };
}

function createTaskCostPreviewLite(context: TuiContext): TerminalReadinessView["costPreview"] {
  const labels = ["local-only", "no-network", "no-real-smoke", "advisory-estimate"];
  if (context.lastVerification) labels.push("may-run-tests");
  if (context.backgroundTasks.length > 0) labels.push("background-visible");
  if (context.lastProviderFailure) labels.push("provider-diagnostic-only");
  return {
    status: "partial",
    level: context.lastVerification || context.backgroundTasks.length > 0 ? "medium" : "light",
    labels,
    nextAction:
      "advisory estimate only; confirm before tests, provider calls, network, or release actions",
  };
}

function readPackageJsonLite(projectPath: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(join(projectPath, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

function hasAnyFile(projectPath: string, files: string[]): boolean {
  return files.some((file) => existsSync(join(projectPath, file)));
}

function hasPackageDependency(
  packageJson: Record<string, unknown> | undefined,
  dependency: string,
): boolean {
  if (!packageJson) return false;
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
    (section) => typeof readRecord(packageJson[section])[dependency] === "string",
  );
}

function readGitStatusShortLite(projectPath: string): string[] | undefined {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: projectPath,
    encoding: "utf8",
    shell: false,
    timeout: 2_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readPackageManagerLite(
  packageJson: Record<string, unknown> | undefined,
  projectPath: string,
): string {
  if (typeof packageJson?.packageManager === "string") return packageJson.packageManager;
  if (existsSync(join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectPath, "package-lock.json"))) return "npm";
  if (existsSync(join(projectPath, "yarn.lock"))) return "yarn";
  return "unknown";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readTextFileLite(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function createTerminalProblems(
  context: TuiContext,
  webSourceEvidence: "present" | "missing",
  lite: Pick<
    TerminalReadinessView,
    "projectDoctor" | "sourceDrift" | "contextPicker" | "rollbackCoach" | "costPreview"
  >,
): TerminalProblemView[] {
  const problems: TerminalProblemView[] = [];
  if (context.lastVerification && context.lastVerification.status !== "pass") {
    problems.push({
      source: "verification",
      severity:
        context.lastVerification.status === "fail" || context.lastVerification.status === "timeout"
          ? "error"
          : "warning",
      summary: `${context.lastVerification.status}: ${context.lastVerification.summary}`,
      nextAction: context.lastVerification.nextAction,
      detailRef: "/verify last",
    });
  }
  if (context.lastProviderFailure) {
    problems.push({
      source: "provider",
      severity: "error",
      summary: `${context.lastProviderFailure.code}: ${context.lastProviderFailure.provider}/${context.lastProviderFailure.model}`,
      nextAction: "/model doctor",
      detailRef: "/details evidence",
    });
  }
  const cooldownDoctorLine = formatCooldownDoctorLine(context.providerBreaker, context.language);
  if (cooldownDoctorLine) {
    problems.push({
      source: "provider",
      severity: "warning",
      summary: cooldownDoctorLine,
      nextAction: "/model doctor",
    });
  }
  for (const task of context.backgroundTasks.filter((item) =>
    ["failed", "cancelled", "timeout", "stale"].includes(item.status),
  )) {
    problems.push({
      source: "background",
      severity: task.status === "failed" || task.status === "timeout" ? "error" : "warning",
      summary: `${task.kind} ${task.status}: ${task.userVisibleSummary}`,
      nextAction: task.nextAction ?? `/details background ${task.id}`,
      detailRef: `/details background ${task.id}`,
    });
  }
  if (webSourceEvidence === "missing") {
    problems.push({
      source: "freshness",
      severity: "warning",
      summary:
        "No web_source evidence in the current session; current/external facts must stay unverified.",
      nextAction: "Mark latest/current/external facts as unverified unless evidence is added.",
      detailRef: "/details evidence",
    });
  }
  if (context.index.status === "stale" || context.index.status === "error") {
    problems.push({
      source: "index",
      severity: context.index.status === "error" ? "error" : "warning",
      summary: `index status=${context.index.status}${context.index.staleHint ? ` ${context.index.staleHint}` : ""}`,
      nextAction: "/index doctor",
      detailRef: "/index status",
    });
  }
  if (lite.projectDoctor.status !== "pass") {
    problems.push({
      source: "project",
      severity: "warning",
      summary: `Project Doctor Lite status=${lite.projectDoctor.status} unknown=${lite.projectDoctor.unknown.join(",") || "none"}`,
      nextAction: "/doctor project",
    });
  }
  if (lite.sourceDrift.status !== "pass") {
    problems.push({
      source: "drift",
      severity: "warning",
      summary: `Source-of-Truth Drift Linter Lite issues=${lite.sourceDrift.issues.join(",") || "none"}`,
      nextAction: lite.sourceDrift.nextAction,
    });
  }
  if (lite.contextPicker.status !== "pass") {
    problems.push({
      source: "context",
      severity: "warning",
      summary: `Context Picker Lite refs=${lite.contextPicker.refs.length} index=${lite.contextPicker.indexFreshness}`,
      nextAction: "/doctor project",
    });
  }
  if (lite.rollbackCoach.status !== "pass") {
    problems.push({
      source: "rollback",
      severity: "info",
      summary: `Rollback Coach Lite changedFiles=${lite.rollbackCoach.changedFiles} untracked=${lite.rollbackCoach.untrackedFiles} checkpoints=${lite.rollbackCoach.checkpoints}; read-only advice only`,
      nextAction: lite.rollbackCoach.nextAction,
    });
  }
  if (lite.costPreview.status !== "pass") {
    problems.push({
      source: "cost",
      severity: "warning",
      summary: `Task Cost Preview Lite level=${lite.costPreview.level}`,
      nextAction: lite.costPreview.nextAction,
    });
  }
  return problems;
}
