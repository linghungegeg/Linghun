import type { Language, PermissionMode } from "@linghun/shared";

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
  problems: TerminalProblemView[];
};

export type TerminalProblemView = {
  source: "verification" | "provider" | "background" | "freshness" | "index";
  severity: "info" | "warning" | "error";
  summary: string;
  nextAction: string;
  detailRef?: string;
};

const PASSABLE_STATUSES = new Set<ReadinessItemStatus>(["pass"]);

export function formatTerminalReadinessDoctor(view: TerminalReadinessView): string {
  const items = createReadinessItems(view);
  const passCount = items.filter((item) => PASSABLE_STATUSES.has(item.status)).length;
  const blockedCount = items.filter((item) => item.status !== "pass").length;
  const header =
    view.language === "en-US"
      ? "Terminal readiness doctor (local/static only; not real smoke)"
      : "Terminal readiness doctor（仅本地/静态轻量检查；不是真实 smoke）";
  const summary =
    view.language === "en-US"
      ? `Summary: ${passCount}/${items.length} local checks are pass; ${blockedCount} need attention. This is not Beta PASS, smoke-ready, or open-source-ready.`
      : `摘要：${passCount}/${items.length} 项本地检查为 pass；${blockedCount} 项需要处理。这不是 Beta PASS、smoke-ready 或 open-source-ready。`;
  const lines = [
    header,
    summary,
    view.language === "en-US"
      ? `Runtime: provider=${short(view.provider, 28)} model=${short(view.model, 36)} endpoint=${view.endpointProfile} mode=${view.permissionMode}`
      : `运行时：provider=${short(view.provider, 28)} model=${short(view.model, 36)} endpoint=${view.endpointProfile} mode=${view.permissionMode}`,
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
  lines.push(
    view.language === "en-US"
      ? "Details: use /model doctor, /index doctor, /cache status, /memory, /mcp doctor, /background, /verify last, /problems."
      : "详情：使用 /model doctor、/index doctor、/cache status、/memory、/mcp doctor、/background、/verify last、/problems。",
  );
  return lines.join("\n");
}

export function formatTerminalReadinessStatus(view: TerminalReadinessView): string {
  const items = createReadinessItems(view);
  const blocked = items.filter((item) => item.status !== "pass");
  const headline =
    view.language === "en-US"
      ? `Readiness: local=${items.length - blocked.length}/${items.length} pass · blockers=${blocked.length} · no smoke/Beta PASS`
      : `Readiness：本地 ${items.length - blocked.length}/${items.length} pass · 待处理=${blocked.length} · 非 smoke/Beta PASS`;
  const top = blocked.slice(0, 3).map((item) => `${item.label}=${item.status}`);
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
      status: view.providerFailure ? "fail" : view.provider === "unknown" ? "unknown" : "pass",
      summary: view.providerFailure
        ? `last failure ${view.providerFailure.code} on ${view.providerFailure.provider}/${view.providerFailure.model}`
        : `configured ${view.provider}/${view.model}`,
      nextAction: view.providerFailure ? "/model doctor" : "/model doctor for details",
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
      summary: `status=${view.index.status}${typeof view.index.changedFiles === "number" ? ` changedFiles=${view.index.changedFiles}` : ""}`,
      nextAction: view.index.status === "ready" ? "/index status" : "/index doctor",
    },
    {
      id: "cache",
      label: "cache/context",
      status: view.cache.workspaceSnapshot === "ready" ? "pass" : "partial",
      summary: `hitRate=${formatPercent(view.cache.latestHitRate)} compact=${view.cache.compacted ? "yes" : "no"} workspaceSnapshot=${view.cache.workspaceSnapshot}`,
      nextAction: "/cache status",
    },
    {
      id: "memory",
      label: "memory/rules",
      status: view.memory.projectRules === "found" ? "pass" : "partial",
      summary: `projectRules=${view.memory.projectRules} candidates=${view.memory.candidates} accepted=${view.memory.accepted}`,
      nextAction: "/memory",
    },
    {
      id: "mcp",
      label: "mcp/connect",
      status: view.mcp.errors > 0 ? "partial" : view.mcp.enabled ? "pass" : "unknown",
      summary: `enabled=${view.mcp.enabled ? "yes" : "no"} servers=${view.mcp.servers} tools=${view.mcp.tools} errors=${view.mcp.errors}`,
      nextAction: "/mcp doctor",
    },
    {
      id: "background",
      label: "background/tasks",
      status:
        view.background.blocked > 0 ? "partial" : view.background.running > 0 ? "unknown" : "pass",
      summary: `total=${view.background.total} running=${view.background.running} blocked=${view.background.blocked}`,
      nextAction: view.background.total > 0 ? "/background" : "no action",
    },
    {
      id: "verification",
      label: "verification",
      status: verificationStatus,
      summary: view.verification
        ? `status=${view.verification.status} unverified=${view.verification.unverified} risk=${view.verification.risk}`
        : "no recent verification",
      nextAction: view.verification ? "/verify last" : "/verify plan",
    },
    {
      id: "freshness",
      label: "freshness/web evidence",
      status: view.freshness.webSourceEvidence === "present" ? "pass" : "unknown",
      summary: `web_source_evidence=${view.freshness.webSourceEvidence}`,
      nextAction:
        view.freshness.webSourceEvidence === "present"
          ? "/details evidence"
          : "mark current/external facts as unverified",
    },
  ];
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
    .replace(/[A-Z]:[\\/][^\s)]+/gu, "[local-path]")
    .replace(/\/[\w.-]*?(?:Linghun|linghun)[^\s)]*/gu, "[local-path]");
}

function short(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
