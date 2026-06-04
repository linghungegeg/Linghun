import type { Language, PermissionMode } from "@linghun/shared";
import {
  formatRuntimePathDoctor,
  formatStartupPathDoctor,
  formatVerificationLevelDoctor,
} from "./guard-wiring.js";
import type { RuntimePathMarker, StartupPathMarker } from "./runtime-path-marker.js";
import type { VerificationLevelClassification } from "./verification-level.js";

export type ReadinessItemStatus = "pass" | "partial" | "fail" | "unknown" | "stale" | "blocked";

export type TerminalReadinessItem = {
  id: string;
  label: string;
  status: ReadinessItemStatus;
  summary: string;
  nextAction: string;
};

export type TerminalReadinessView = {
  projectPath: string;
  provider: string;
  model: string;
  endpointProfile: string;
  // D.14A-R-Fix P1-5 — provider/model readiness 只有在本会话观察到真实 provider
  // 响应（cache history 有真实 usage 记录）时才算 live-verified；仅"配置存在"
  // 不算 provider 可用，避免 readiness/status/doctor 误读为 pass。
  providerLiveVerified: boolean;
  permissionMode: PermissionMode;
  language: Language;
  index: { status: string; changedFiles?: number | null; staleHint?: string };
  cache: { latestHitRate: number | null; compacted: boolean; workspaceSnapshot: string };
  memory: {
    projectRules: "found" | "missing" | "unreadable";
    candidates: number;
    accepted: number;
  };
  mcp: { enabled: boolean; servers: number; tools: number; errors: number };
  background: { total: number; running: number; blocked: number };
  verification?: { status: string; summary: string; unverified: number; risk: number };
  providerFailure?: {
    code: string;
    provider: string;
    model: string;
    endpointProfile: string;
    summary: string;
  };
  freshness: { webSourceEvidence: "present" | "missing" };
  runtimePath?: {
    path: string;
    kind: "main" | "fallback";
    canClaimMature: boolean;
    degradedReason?: string;
  };
  verificationLevel?: {
    level: string;
    canClaimPass: boolean;
    canClaimMature: boolean;
    upgradeBlocked: boolean;
    blockReason?: string;
  };
  startupPath?: {
    entryKind: string;
    isVerifiedCurrent: boolean;
    staleRisk: boolean;
    staleReason?: string;
  };
  projectDoctor: {
    status: ReadinessItemStatus;
    packageManager: string;
    scripts: string[];
    configFiles: string[];
    ciFiles: string[];
    projectRules: "found" | "missing" | "unreadable";
    checks: string[];
    unknown: string[];
  };
  sourceDrift: {
    status: ReadinessItemStatus;
    checked: string[];
    issues: string[];
    nextAction: string;
  };
  contextPicker: {
    status: ReadinessItemStatus;
    refs: string[];
    evidenceKinds: string[];
    indexFreshness: "fresh" | "stale" | "unknown";
  };
  rollbackCoach: {
    status: ReadinessItemStatus;
    changedFiles: number;
    untrackedFiles: number;
    checkpoints: number;
    gitStatus: "clean" | "dirty" | "unavailable";
    mode: "advisory-only";
    nextAction: string;
  };
  costPreview: {
    status: ReadinessItemStatus;
    level: "light" | "medium" | "heavy" | "unknown";
    labels: string[];
    nextAction: string;
  };
  problems: TerminalProblemView[];
};

export type TerminalProblemView = {
  source:
    | "verification"
    | "provider"
    | "background"
    | "freshness"
    | "index"
    | "project"
    | "drift"
    | "context"
    | "rollback"
    | "cost";
  severity: "info" | "warning" | "error";
  summary: string;
  nextAction: string;
  detailRef?: string;
};

const PASSABLE_STATUSES = new Set<ReadinessItemStatus>(["pass"]);

export function formatTerminalReadinessDoctor(
  view: TerminalReadinessView,
  options: { showAll?: boolean } = {},
): string {
  const items = createReadinessItems(view);
  if (!options.showAll) {
    return formatTerminalReadinessDoctorSummary(view, items);
  }

  const passCount = items.filter((item) => PASSABLE_STATUSES.has(item.status)).length;
  const blockedCount = items.filter((item) => item.status !== "pass").length;
  const header =
    view.language === "en-US"
      ? "Doctor details (local/static only; not real smoke)"
      : "诊断详情（仅本地/静态轻量检查；不是真实 smoke）";
  const summary =
    view.language === "en-US"
      ? `Summary: ${passCount}/${items.length} local checks are pass; ${blockedCount} need attention. This is not Beta PASS, smoke-ready, or open-source-ready.`
      : `摘要：${passCount}/${items.length} 项本地检查为 pass；${blockedCount} 项需要处理。这不是 Beta PASS、smoke-ready 或 open-source-ready。`;
  const lines = [
    header,
    summary,
    view.language === "en-US"
      ? `Runtime: provider ${short(view.provider, 28)} · model ${short(view.model, 36)} · endpoint ${view.endpointProfile} · mode ${view.permissionMode}`
      : `运行时：provider ${short(view.provider, 28)} · model ${short(view.model, 36)} · endpoint ${view.endpointProfile} · mode ${view.permissionMode}`,
    view.language === "en-US"
      ? `Project: ${displayProject(view.projectPath)}`
      : `项目：${displayProject(view.projectPath)}`,
    view.language === "en-US" ? "Checklist:" : "检查项：",
  ];
  for (const item of items) {
    lines.push(
      `- [${item.status.toUpperCase()}] ${item.label}: ${item.summary}; ${view.language === "en-US" ? "next" : "下一步"}: ${item.nextAction}`,
    );
  }
  lines.push(...formatReadinessLiteSections(view));
  lines.push(
    view.language === "en-US"
      ? "Details: use /model doctor, /index doctor, /cache status, /memory, /mcp doctor, /background, /verify last, /problems."
      : "详情：使用 /model doctor、/index doctor、/cache status、/memory、/mcp doctor、/background、/verify last、/problems。",
  );
  return lines.join("\n");
}

function formatTerminalReadinessDoctorSummary(
  view: TerminalReadinessView,
  items: TerminalReadinessItem[],
): string {
  const attention = items.filter((item) => item.status !== "pass");
  const hardBlocks = attention.filter(
    (item) => item.status === "fail" || item.status === "blocked",
  );
  const conclusion = hardBlocks.length > 0 ? "BLOCK" : attention.length > 0 ? "WARN" : "OK";
  const visible = [
    ...hardBlocks,
    ...attention.filter((item) => item.status !== "fail" && item.status !== "blocked"),
  ];
  const lines = [
    view.language === "en-US"
      ? `Doctor: ${conclusion} — local checks only, not a smoke or Beta verdict.`
      : `诊断：${conclusion} — 仅本地检查，不是真实 smoke 或 Beta 结论。`,
    view.language === "en-US"
      ? `Scope: ${items.length - attention.length}/${items.length} local checks pass; ${attention.length} need attention.`
      : `范围：${items.length - attention.length}/${items.length} 项本地检查通过；${attention.length} 项需要处理。`,
  ];

  if (visible.length === 0) {
    lines.push(
      view.language === "en-US" ? "Reason: no local blockers found." : "原因：未发现本地阻塞项。",
    );
    lines.push(
      view.language === "en-US"
        ? "Next: use /doctor all for details before claiming readiness."
        : "下一步：如需完整清单，用 /doctor all；不要据此宣称整体 ready。",
    );
    return lines.join("\n");
  }

  lines.push(view.language === "en-US" ? "Needs attention:" : "需要处理：");
  for (const item of visible) {
    lines.push(
      `- [${item.status.toUpperCase()}] ${item.label}: ${short(sanitizePrimary(item.summary), 96)}; ${view.language === "en-US" ? "next" : "下一步"}: ${sanitizePrimary(item.nextAction)}`,
    );
  }
  if (attention.length > visible.length) {
    lines.push(
      view.language === "en-US"
        ? `- ${attention.length - visible.length} more item(s) hidden from the default view.`
        : `- 默认视图已隐藏 ${attention.length - visible.length} 个较低优先级项目。`,
    );
  }
  lines.push(
    view.language === "en-US"
      ? "Details: /doctor all. Problems: /problems."
      : "详情：/doctor all。问题列表：/problems。",
  );
  return lines.join("\n");
}

export function formatTerminalReadinessStatus(view: TerminalReadinessView): string {
  const items = createReadinessItems(view);
  const blocked = items.filter((item) => item.status !== "pass");
  const headline =
    view.language === "en-US"
      ? `Readiness: local ${items.length - blocked.length}/${items.length} pass · blockers ${blocked.length} · no smoke/Beta PASS`
      : `Readiness：本地 ${items.length - blocked.length}/${items.length} pass · 待处理 ${blocked.length} · 非 smoke/Beta PASS`;
  const top = blocked.slice(0, 3).map((item) => `${item.label}: ${item.status}`);
  return [headline, top.length > 0 ? `- ${top.join("; ")}` : undefined].filter(Boolean).join("\n");
}

export function formatTerminalProblemsPanel(view: TerminalReadinessView): string {
  const problems = view.problems.slice(0, 8);
  if (problems.length === 0) {
    return view.language === "en-US"
      ? "Problems Lite: no current local verification/provider/background/freshness problems. This is not a readiness PASS."
      : "Problems Lite：当前没有本地 verification/provider/background/freshness 问题。这不代表 readiness PASS。";
  }
  const lines = [
    view.language === "en-US"
      ? `Problems Lite: ${problems.length} current problem(s); derived from local runtime evidence only.`
      : `Problems Lite：当前 ${problems.length} 个问题；仅来自本地 runtime evidence。`,
  ];
  for (const problem of problems) {
    lines.push(
      `- [${problem.severity.toUpperCase()}] ${problem.source}: ${short(sanitizePrimary(problem.summary), 140)}; ${view.language === "en-US" ? "next" : "下一步"}: ${sanitizePrimary(problem.nextAction)}${problem.detailRef ? ` (${sanitizePrimary(problem.detailRef)})` : ""}`,
    );
  }
  lines.push(
    view.language === "en-US"
      ? "Open details with /verify last, /details evidence, /details background <id>, or provider/index/cache doctors."
      : "可用 /verify last、/details evidence、/details background <id> 或 provider/index/cache doctor 查看详情。",
  );
  return lines.join("\n");
}

export function createReadinessItems(view: TerminalReadinessView): TerminalReadinessItem[] {
  const verificationStatus = classifyVerification(view.verification?.status);
  return [
    {
      id: "provider",
      label: "provider/model",
      // D.14A-R-Fix P1-5 — 没有真实 endpoint/provider evidence 时不显示 pass。
      // last failure → fail；provider unknown → unknown；已配置但未 live-verified
      // → partial（configured / not live-verified）；只有 live-verified 才 pass。
      status: view.providerFailure
        ? "fail"
        : view.provider === "unknown"
          ? "unknown"
          : view.providerLiveVerified
            ? "pass"
            : "partial",
      summary: view.providerFailure
        ? `last failure ${view.providerFailure.code} on ${view.providerFailure.provider}/${view.providerFailure.model}`
        : view.providerLiveVerified
          ? `live-verified ${view.provider}/${view.model}`
          : `configured ${view.provider}/${view.model}; not live-verified`,
      nextAction: view.providerFailure
        ? "/model doctor"
        : view.providerLiveVerified
          ? "/model doctor for details"
          : "send a message or run a real provider smoke to live-verify; /model doctor for config",
    },
    {
      id: "index",
      label: "index",
      status:
        view.index.status === "ready"
          ? "pass"
          : view.index.status === "stale"
            ? "stale"
            : view.index.status === "missing" || view.index.status === "error"
              ? "partial"
              : "unknown",
      summary:
        view.language === "en-US"
          ? `status ${view.index.status}${typeof view.index.changedFiles === "number" ? `; changed files ${view.index.changedFiles}` : ""}`
          : `状态 ${view.index.status}${typeof view.index.changedFiles === "number" ? `；改动文件 ${view.index.changedFiles}` : ""}`,
      nextAction: view.index.status === "ready" ? "/index status" : "/index doctor",
    },
    {
      id: "cache",
      label: "cache/context",
      status: view.cache.workspaceSnapshot === "ready" ? "pass" : "partial",
      summary:
        view.language === "en-US"
          ? `hit rate ${formatPercent(view.cache.latestHitRate)}; compacted ${view.cache.compacted ? "yes" : "no"}; workspace snapshot ${view.cache.workspaceSnapshot}`
          : `命中率 ${formatPercent(view.cache.latestHitRate)}；已压缩 ${view.cache.compacted ? "是" : "否"}；工作区快照 ${view.cache.workspaceSnapshot}`,
      nextAction: "/cache status",
    },
    {
      id: "memory",
      label: "memory/rules",
      status: view.memory.projectRules === "found" ? "pass" : "partial",
      summary:
        view.language === "en-US"
          ? `project rules ${view.memory.projectRules}; candidates ${view.memory.candidates}; accepted ${view.memory.accepted}`
          : `项目规则 ${view.memory.projectRules}；候选 ${view.memory.candidates}；已接受 ${view.memory.accepted}`,
      nextAction: "/memory",
    },
    {
      id: "mcp",
      label: "mcp/connect",
      status:
        view.mcp.errors > 0
          ? "partial"
          : view.mcp.enabled && view.mcp.tools > 0
            ? "pass"
            : view.mcp.servers > 0
              ? "partial"
              : "unknown",
      summary:
        view.language === "en-US"
          ? `enabled ${view.mcp.enabled ? "yes" : "no"}; servers ${view.mcp.servers}; tools ${view.mcp.tools}; errors ${view.mcp.errors}`
          : `启用 ${view.mcp.enabled ? "是" : "否"}；服务 ${view.mcp.servers}；工具 ${view.mcp.tools}；错误 ${view.mcp.errors}`,
      nextAction: "/mcp doctor",
    },
    {
      id: "background",
      label: "background/tasks",
      status:
        view.background.blocked > 0 ? "partial" : view.background.running > 0 ? "unknown" : "pass",
      summary:
        view.language === "en-US"
          ? `total ${view.background.total}; running ${view.background.running}; blocked ${view.background.blocked}`
          : `总数 ${view.background.total}；运行中 ${view.background.running}；阻塞 ${view.background.blocked}`,
      nextAction: view.background.total > 0 ? "/background" : "no action",
    },
    {
      id: "verification",
      label: "verification",
      status: verificationStatus,
      summary: view.verification
        ? view.language === "en-US"
          ? `status ${view.verification.status}; unverified ${view.verification.unverified}; risk ${view.verification.risk}`
          : `状态 ${view.verification.status}；未验证 ${view.verification.unverified}；风险 ${view.verification.risk}`
        : "no recent verification",
      nextAction: view.verification ? "/verify last" : "/verify plan",
    },
    {
      id: "freshness",
      label: "freshness/web evidence",
      status: view.freshness.webSourceEvidence === "present" ? "partial" : "unknown",
      summary:
        view.language === "en-US"
          ? `web source evidence ${view.freshness.webSourceEvidence}; local presence is not source validation`
          : `网页证据 ${view.freshness.webSourceEvidence}；本地存在不等于来源已验证`,
      nextAction:
        view.freshness.webSourceEvidence === "present"
          ? "/details evidence to confirm relevance and recency"
          : "mark current/external facts as unverified",
    },
    {
      id: "project-doctor",
      label: "project doctor lite",
      status: view.projectDoctor.status,
      summary:
        view.language === "en-US"
          ? `package manager ${view.projectDoctor.packageManager}; scripts ${view.projectDoctor.scripts.length}; checks ${view.projectDoctor.checks.length}; configs ${view.projectDoctor.configFiles.length}; ci ${view.projectDoctor.ciFiles.length}; unknown ${view.projectDoctor.unknown.length}`
          : `包管理器 ${view.projectDoctor.packageManager}；脚本 ${view.projectDoctor.scripts.length}；检查 ${view.projectDoctor.checks.length}；配置 ${view.projectDoctor.configFiles.length}；CI ${view.projectDoctor.ciFiles.length}；未知 ${view.projectDoctor.unknown.length}`,
      nextAction: "/doctor project",
    },
    {
      id: "source-drift",
      label: "source-of-truth drift lite",
      status: view.sourceDrift.status,
      summary:
        view.language === "en-US"
          ? `checked ${view.sourceDrift.checked.length}; issues ${view.sourceDrift.issues.length}`
          : `已检查 ${view.sourceDrift.checked.length}；问题 ${view.sourceDrift.issues.length}`,
      nextAction: view.sourceDrift.nextAction,
    },
    {
      id: "context-picker",
      label: "context picker lite",
      status: view.contextPicker.status,
      summary:
        view.language === "en-US"
          ? `refs ${view.contextPicker.refs.length}; evidence kinds ${view.contextPicker.evidenceKinds.length}; index ${view.contextPicker.indexFreshness}`
          : `引用 ${view.contextPicker.refs.length}；证据类型 ${view.contextPicker.evidenceKinds.length}；索引 ${view.contextPicker.indexFreshness}`,
      nextAction: "/doctor project",
    },
    {
      id: "rollback-coach",
      label: "rollback coach lite",
      status: view.rollbackCoach.status,
      summary:
        view.language === "en-US"
          ? `changed files ${view.rollbackCoach.changedFiles}; untracked ${view.rollbackCoach.untrackedFiles}; checkpoints ${view.rollbackCoach.checkpoints}; git status ${view.rollbackCoach.gitStatus}; mode ${view.rollbackCoach.mode}`
          : `改动文件 ${view.rollbackCoach.changedFiles}；未跟踪 ${view.rollbackCoach.untrackedFiles}；检查点 ${view.rollbackCoach.checkpoints}；git 状态 ${view.rollbackCoach.gitStatus}；模式 ${view.rollbackCoach.mode}`,
      nextAction: view.rollbackCoach.nextAction,
    },
    {
      id: "task-cost-preview",
      label: "task cost preview lite",
      status: view.costPreview.status,
      summary:
        view.language === "en-US"
          ? `level ${view.costPreview.level}; labels ${view.costPreview.labels.join(", ")}`
          : `级别 ${view.costPreview.level}；标签 ${view.costPreview.labels.join("、")}`,
      nextAction: view.costPreview.nextAction,
    },
    ...(view.runtimePath ? [guardRuntimePathToReadinessItem(view.runtimePath, view.language)] : []),
    ...(view.verificationLevel
      ? [guardVerificationLevelToReadinessItem(view.verificationLevel, view.language)]
      : []),
    ...(view.startupPath ? [guardStartupPathToReadinessItem(view.startupPath, view.language)] : []),
  ];
}

function formatReadinessLiteSections(view: TerminalReadinessView): string[] {
  const lines = [view.language === "en-US" ? "Lite readiness surfaces:" : "轻量就绪入口："];
  const projectUnknown = view.projectDoctor.unknown.length
    ? view.language === "en-US"
      ? ` · unknown ${safeReadableList(view.projectDoctor.unknown)}`
      : ` · 未知 ${safeReadableList(view.projectDoctor.unknown)}`
    : "";
  if (view.language === "en-US") {
    lines.push(
      `- Project Doctor Lite: [${view.projectDoctor.status.toUpperCase()}] package manager ${view.projectDoctor.packageManager} · scripts ${safeReadableList(view.projectDoctor.scripts)} · checks ${safeReadableList(view.projectDoctor.checks)} · configs ${safeReadableList(view.projectDoctor.configFiles)} · ci ${safeReadableList(view.projectDoctor.ciFiles)} · project rules ${view.projectDoctor.projectRules}${projectUnknown}`,
    );
    lines.push(
      `- Source-of-Truth Drift Linter Lite: [${view.sourceDrift.status.toUpperCase()}] checked ${safeReadableList(view.sourceDrift.checked)} · issues ${safeReadableList(view.sourceDrift.issues)} · next ${view.sourceDrift.nextAction}`,
    );
    lines.push(
      `- Context Picker Lite: [${view.contextPicker.status.toUpperCase()}] refs ${safeReadableList(view.contextPicker.refs)} · evidence kinds ${safeReadableList(view.contextPicker.evidenceKinds)} · index ${view.contextPicker.indexFreshness}`,
    );
    lines.push(
      `- Rollback Coach Lite: [${view.rollbackCoach.status.toUpperCase()}] changed files ${view.rollbackCoach.changedFiles} · untracked ${view.rollbackCoach.untrackedFiles} · checkpoints ${view.rollbackCoach.checkpoints} · git status ${view.rollbackCoach.gitStatus} · mode ${view.rollbackCoach.mode} · next ${view.rollbackCoach.nextAction}`,
    );
    lines.push(
      `- Task Cost Preview Lite: [${view.costPreview.status.toUpperCase()}] level ${view.costPreview.level} · labels ${safeReadableList(view.costPreview.labels)} · next ${view.costPreview.nextAction}`,
    );
    return lines.map(sanitizePrimary);
  }
  lines.push(
    `- Project Doctor Lite: [${view.projectDoctor.status.toUpperCase()}] 包管理器 ${view.projectDoctor.packageManager} · 脚本 ${safeReadableList(view.projectDoctor.scripts)} · 检查 ${safeReadableList(view.projectDoctor.checks)} · 配置 ${safeReadableList(view.projectDoctor.configFiles)} · CI ${safeReadableList(view.projectDoctor.ciFiles)} · 项目规则 ${view.projectDoctor.projectRules}${projectUnknown}`,
  );
  lines.push(
    `- Source-of-Truth Drift Linter Lite: [${view.sourceDrift.status.toUpperCase()}] 已检查 ${safeReadableList(view.sourceDrift.checked)} · 问题 ${safeReadableList(view.sourceDrift.issues)} · 下一步 ${view.sourceDrift.nextAction}`,
  );
  lines.push(
    `- Context Picker Lite: [${view.contextPicker.status.toUpperCase()}] 引用 ${safeReadableList(view.contextPicker.refs)} · 证据类型 ${safeReadableList(view.contextPicker.evidenceKinds)} · 索引 ${view.contextPicker.indexFreshness}`,
  );
  lines.push(
    `- Rollback Coach Lite: [${view.rollbackCoach.status.toUpperCase()}] 改动文件 ${view.rollbackCoach.changedFiles} · 未跟踪 ${view.rollbackCoach.untrackedFiles} · 检查点 ${view.rollbackCoach.checkpoints} · git 状态 ${view.rollbackCoach.gitStatus} · 模式 ${view.rollbackCoach.mode} · 下一步 ${view.rollbackCoach.nextAction}`,
  );
  lines.push(
    `- Task Cost Preview Lite: [${view.costPreview.status.toUpperCase()}] 级别 ${view.costPreview.level} · 标签 ${safeReadableList(view.costPreview.labels)} · 下一步 ${view.costPreview.nextAction}`,
  );
  return lines.map(sanitizePrimary);
}

function classifyVerification(status: string | undefined): ReadinessItemStatus {
  if (!status) return "unknown";
  if (status === "pass") return "pass";
  if (status === "cancelled" || status === "timeout" || status === "stale") return "blocked";
  if (status === "fail") return "fail";
  return "partial";
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "unknown";
  return `${Math.round(value * 100)}%`;
}

function safeReadableList(values: string[]): string {
  if (values.length === 0) return "none";
  return values
    .map((value) => short(sanitizePrimary(value).replace(/=/gu, " "), 32))
    .join(", ");
}

function displayProject(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const tail = parts.at(-1) ?? "project";
  return short(`…/${tail}`, 90);
}

function sanitizePrimary(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer ***")
    .replace(/api[_-]?key=[^\s&]+/giu, "api_key=***")
    .replace(/[A-Z]:[\\/][^\s)]+/gu, (match) => {
      // Preserve the basename for context, hide the full path
      const parts = match.replace(/\\/g, "/").split("/");
      const tail = parts.at(-1) ?? "file";
      return `[…/${tail}]`;
    })
    .replace(/\/(?:home|Users|tmp|var|private)\/[^\s)]*/gu, (match) => {
      const parts = match.split("/");
      const tail = parts.at(-1) ?? "file";
      return `[…/${tail}]`;
    });
}

function short(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

// ---------------------------------------------------------------------------
// Guard wiring adapters — convert view fields to natural-language readiness items
// ---------------------------------------------------------------------------

function guardRuntimePathToReadinessItem(
  rp: NonNullable<TerminalReadinessView["runtimePath"]>,
  language: Language,
): TerminalReadinessItem {
  const marker: RuntimePathMarker = {
    path: rp.path as RuntimePathMarker["path"],
    kind: rp.kind,
    isMainPath: rp.kind === "main",
    isFallback: rp.kind === "fallback",
    canClaimMature: rp.canClaimMature,
    degradedReason: rp.degradedReason,
    detectionMethod: "default",
  };
  const item = formatRuntimePathDoctor(marker, language);
  return {
    id: item.id,
    label: item.label,
    status: item.ok ? "pass" : ("partial" as ReadinessItemStatus),
    summary: item.summary,
    nextAction: item.nextAction,
  };
}

function guardVerificationLevelToReadinessItem(
  vl: NonNullable<TerminalReadinessView["verificationLevel"]>,
  language: Language,
): TerminalReadinessItem {
  const classification: VerificationLevelClassification = {
    level: vl.level as VerificationLevelClassification["level"],
    isRealSmoke: vl.level === "real-smoke",
    canClaimMature: vl.canClaimMature,
    canClaimPass: vl.canClaimPass,
    upgradeBlocked: vl.upgradeBlocked,
    blockReason: vl.blockReason,
    requiredForMature: vl.canClaimMature ? "already-mature" : "real-smoke-required",
  };
  const item = formatVerificationLevelDoctor(classification, language);
  return {
    id: item.id,
    label: item.label,
    status: (vl.canClaimPass
      ? vl.canClaimMature
        ? "pass"
        : "partial"
      : "unknown") as ReadinessItemStatus,
    summary: item.summary,
    nextAction: item.nextAction,
  };
}

function guardStartupPathToReadinessItem(
  sp: NonNullable<TerminalReadinessView["startupPath"]>,
  language: Language,
): TerminalReadinessItem {
  const marker: StartupPathMarker = {
    entryKind: sp.entryKind as StartupPathMarker["entryKind"],
    isVerifiedCurrent: sp.isVerifiedCurrent,
    staleRisk: sp.staleRisk,
    staleReason: sp.staleReason,
  };
  const item = formatStartupPathDoctor(marker, language);
  return {
    id: item.id,
    label: item.label,
    status: item.ok ? "pass" : ("partial" as ReadinessItemStatus),
    summary: item.summary,
    nextAction: item.nextAction,
  };
}
