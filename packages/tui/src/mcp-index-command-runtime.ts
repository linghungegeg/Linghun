import { basename } from "node:path";
import type { TuiContext } from "./index.js";
import { redactedPath } from "./process-command-runtime.js";
import type { CommandPanelView } from "./shell/types.js";
import { sanitizeDiagnosticText, truncateDisplay } from "./startup-runtime.js";
const CODEBASE_MEMORY_ENV = "LINGHUN_CODEBASE_MEMORY_MCP";

/**
 * D.13Q-UX Task Surface — /mcp status 的降噪 CommandPanel 视图。
 * 仅暴露：是否启用、server 数量、工具数量、是否需要 doctor、下一步。
 * guard / license / runtime / binary / source / schemaLoaded / endpoint
 * 等内部字段不进 summary / sections，全量原文进 detailsText（Ctrl+O 展开）。
 */
export function buildMcpStatusPanel(context: TuiContext): CommandPanelView {
  const isEn = context.language === "en-US";
  const enabled = context.mcp.enabled;
  const serverCount = context.mcp.servers.length;
  const toolCount = context.mcp.tools.length;
  const needsDoctor = !context.mcp.lastDoctor;
  const summary: string[] = [
    isEn
      ? `MCP ${enabled ? "enabled" : "disabled"} · ${serverCount} server${serverCount === 1 ? "" : "s"} · ${toolCount} tool${toolCount === 1 ? "" : "s"}`
      : `MCP ${enabled ? "已启用" : "未启用"} · 服务器 ${serverCount} · 工具 ${toolCount}`,
  ];
  if (needsDoctor) {
    summary.push(
      isEn ? "Not yet diagnosed — run /mcp doctor to check." : "尚未诊断 — 运行 /mcp doctor 检测。",
    );
  }
  const failingServers = context.mcp.servers.filter(
    (s) => s.status === "error" || s.status === "missing",
  );
  const sections: { title?: string; rows: string[] }[] = [];
  if (serverCount > 0) {
    sections.push({
      title: isEn ? "Servers" : "服务器",
      rows: context.mcp.servers.slice(0, 8).map((s) => `${s.name} · ${s.status}`),
    });
  }
  const actions = ["/mcp doctor", "/mcp tools"];
  if (failingServers.length > 0) actions.push("/mcp validate");
  return {
    title: "/mcp",
    tone: failingServers.length > 0 ? "warning" : "neutral",
    summary,
    sections,
    actions,
    detailsText: formatMcpStatus(context),
  };
}

export function formatMcpStatus(context: TuiContext): string {
  const isEn = context.language === "en-US";
  const notRunHint = isEn ? "not checked" : "未检查";
  const servers = context.mcp.servers.map((server) => `- ${server.name}: ${server.status}`);
  return [
    "MCP status",
    `- enabled: ${context.mcp.enabled ? "yes" : "no"}`,
    `- servers: ${context.mcp.servers.length}`,
    `- tools(stable): ${context.mcp.tools.length}`,
    `- lastDoctor: ${context.mcp.lastDoctor ?? notRunHint}`,
    ...servers,
    isEn ? "- next: /mcp doctor or /mcp tools" : "- 下一步：/mcp doctor 或 /mcp tools",
  ].join("\n");
}

/**
 * D.13Q-UX Task Surface — /index status 的降噪 CommandPanel 视图。
 * 仅暴露：是否启用 / 当前 status / 是否需要 doctor / 下一步建议。
 * source / binaryStatus / binaryCommand / version / artifactPath / runtime /
 * nodes/edges / changedFiles / safety 等内部字段不进 summary，全量原文进
 * detailsText（Ctrl+O 展开）。
 */
export function buildIndexStatusPanel(context: TuiContext): CommandPanelView {
  const isEn = context.language === "en-US";
  const status = context.index.status;
  const enabled = context.index.enabled;
  const isError = status === "error" || status === "missing";
  const summary: string[] = [
    isEn
      ? `Index ${enabled ? "enabled" : "disabled"} · status: ${status}`
      : `索引 ${enabled ? "已启用" : "未启用"} · 状态：${status}`,
  ];
  const actions: string[] = [];
  if (status === "missing") {
    summary.push(
      isEn ? "Not built yet — run /index init fast." : "尚未建立 — 运行 /index init fast。",
    );
    actions.push("/index init fast");
  } else if (status === "stale") {
    summary.push(
      isEn ? "Stale — /index refresh recommended." : "已过期 — 建议运行 /index refresh。",
    );
    actions.push("/index refresh");
  } else if (status === "refresh_completed_but_unverified") {
    summary.push(
      isEn
        ? "Refresh completed; status read-back is unverified — run /index status --fresh."
        : "刷新已完成；状态读回尚未验证 — 运行 /index status --fresh。",
    );
    actions.push("/index status --fresh");
  } else if (status === "error") {
    summary.push(isEn ? "Error — run /index doctor." : "出错 — 运行 /index doctor。");
    actions.push("/index doctor");
  } else if (status === "ready") {
    actions.push("/index search", "/index architecture");
  }
  return {
    title: "/index",
    tone: isError ? "error" : status === "stale" ? "warning" : "neutral",
    summary,
    actions,
    detailsText: formatIndexStatus(context),
  };
}

export function formatIndexStatus(context: TuiContext): string {
  const suggestion =
    context.index.binaryStatus && context.index.binaryStatus !== "ready"
      ? `建议：配置 ${CODEBASE_MEMORY_ENV}，或安装/修复 codebase-memory。`
      : context.index.status === "missing"
        ? context.index.error
          ? "建议：确认 codebase-memory artifact 是否存在；可运行 /index init fast。"
          : "建议：运行 /index init fast 建立索引。"
        : context.index.status === "stale"
          ? "建议：按需刷新索引。"
          : context.index.status === "refresh_completed_but_unverified"
            ? "建议：运行 /index status --fresh 确认。"
          : context.index.status === "error"
            ? "建议：修复 codebase-memory 后重试。"
            : "建议：可用 /index search 或 /index architecture。";
  return [
    "Index status",
    `- enabled: ${context.index.enabled ? "yes" : "no"}`,
    `- project: ${context.index.projectName ?? basename(context.projectPath)}`,
    `- project selection: ${context.index.projectSelectionSource ?? (context.index.projectName ? "root_path" : "missing")}`,
    `- status: ${context.index.status}`,
    `- next action: ${suggestion}`,
  ].join("\n");
}

export function formatIndexRefreshSummary(
  context: TuiContext,
  actionLabel: "init fast" | "refresh" = "refresh",
): string {
  const title = actionLabel === "refresh" ? "Index refresh completed" : "Index init completed";
  const titleZh = actionLabel === "refresh" ? "索引刷新完成" : "索引初始化完成";
  if (context.language === "en-US") {
    return [
      title,
      `- status: ${context.index.status}`,
      "- details: run /index status for the full index status view.",
    ].join("\n");
  }
  return [
    titleZh,
    `- 状态：${context.index.status}`,
    "- 详情：输入 /index status 查看完整索引状态。",
  ].join("\n");
}
