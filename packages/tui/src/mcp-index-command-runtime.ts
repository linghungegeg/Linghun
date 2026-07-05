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
  // D.13Q-UX Real Smoke Fix v3 — /mcp status 默认是中性 diagnostic：
  //   - lastDoctor 未跑时显示"未检测，运行 /mcp doctor 检测"，不再 unknown 吓人；
  //   - codebase-memory binary/version 未知时同样显示"未检测"；
  //   - 末尾"启动或检测失败会隔离"那段触发关键词误伤的文案已删除，统一让
  //     真实失败由 /mcp doctor 的输出承担。
  const isEn = context.language === "en-US";
  const notRunHint = isEn
    ? "not detected — run /mcp doctor to check"
    : "未检测，运行 /mcp doctor 检测";
  const servers = context.mcp.servers.map((server) => {
    const suffix = server.error ? ` (${truncateDisplay(server.error, 80)})` : "";
    return `- ${server.name}: ${server.status}; command ${redactedPath(server.command)}${suffix}`;
  });
  const lastDoctor = context.mcp.lastDoctor ?? notRunHint;
  const memorySource = context.index.binarySource ?? notRunHint;
  const memoryBinary = context.index.binaryStatus ?? notRunHint;
  const memoryVersion = context.index.binaryVersion ?? "-";
  const runtime =
    context.index.runtime ??
    (isEn
      ? "Linghun-managed codebase-memory or external fallback"
      : "Linghun 内置 codebase-memory 或外部 fallback");
  return [
    "MCP status",
    `- enabled: ${context.mcp.enabled ? "yes" : "no"}`,
    `- servers: ${context.mcp.servers.length}`,
    `- tools(stable): ${context.mcp.tools.length}`,
    `- lastDoctor: ${lastDoctor}`,
    ...servers,
    `- codebase-memory source ${memorySource}`,
    `- codebase-memory binary ${memoryBinary}; version ${memoryVersion}`,
    `- runtime: ${runtime}`,
    "- guard: codebase-memory deferred tools currently require Linghun static registry + required args before CLI execution; unknown or incomplete tool calls are rejected.",
    "- guard: extension-contributed MCP/skill/plugin tools must pass discovery + trust + schemaLoaded + compatible runtime before execution.",
    "- license/NOTICE: Linghun-managed codebase-memory must be shipped with license/NOTICE metadata; external fallback is reported as external, not bundled.",
    isEn
      ? "- next: run /mcp doctor for diagnostics, /mcp tools to list registered tools, /index status for codebase-memory state."
      : "- 下一步：运行 /mcp doctor 做诊断、/mcp tools 查看已登记工具、/index status 查看 codebase-memory 状态。",
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
      ? `建议：配置 ${CODEBASE_MEMORY_ENV}，或安装/修复 Linghun-managed codebase-memory；普通聊天不受影响。`
      : context.index.status === "missing"
        ? context.index.error
          ? "建议：确认 codebase-memory artifact 是否存在；可显式运行 /index init fast。普通聊天不受影响。"
          : "建议：运行 /index init fast 建立索引；如发现高风险大文件/生成物，运行 /index repair 写入 .cbmignore 后会真实跳过。"
        : context.index.status === "stale"
          ? "建议：按需刷新索引；如发现大文件/生成物，运行 /index repair 写入 .cbmignore 后会真实跳过。"
          : context.index.status === "refresh_completed_but_unverified"
            ? "建议：索引刷新命令已完成，但读回/新鲜度尚未验证；运行 /index status --fresh 确认。"
          : context.index.status === "error"
            ? "建议：修复 codebase-memory runtime/artifact 后重试 /index doctor 或 /index status。"
            : "建议：可用 /index search <query> 或 /index architecture 获取短结果；新鲜度检查用 /index status --fresh 或 /index check。";
  return [
    "Index status",
    `- enabled: ${context.index.enabled ? "yes" : "no"}`,
    `- project: ${context.index.projectName ?? basename(context.projectPath)}`,
    `- project selection: ${context.index.projectSelectionSource ?? (context.index.projectName ? "root_path" : "missing")}`,
    `- status: ${context.index.status}`,
    `- source: ${context.index.binarySource ?? "unknown"}`,
    `- binary status: ${context.index.binaryStatus ?? "unknown"}`,
    `- binary command: ${context.index.binaryCommand ?? "-"}`,
    `- version: ${context.index.binaryVersion ?? "-"}`,
    `- artifact status: ${context.index.artifactStatus ?? "unknown"}`,
    `- artifact path (details): ${redactedPath(context.index.artifactPath)}`,
    `- runtime: ${context.index.runtime ?? "Linghun-managed codebase-memory or external fallback"}`,
    `- graph: ${context.index.nodes ?? "-"} nodes, ${context.index.edges ?? "-"} edges`,
    `- changed files: ${context.index.changedFiles ?? "-"}`,
    `- stale hint: ${context.index.staleHint ? truncateDisplay(context.index.staleHint, 160) : "-"}`,
    `- safety: ${context.index.safetyRiskyFiles?.length ? `pending risky files ${context.index.safetyRiskyFiles.length}` : "-"}`,
    `- error: ${context.index.error ? truncateDisplay(context.index.error, 120) : "-"}`,
    `- lastQuery: ${context.index.lastQuery ?? "-"}`,
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
