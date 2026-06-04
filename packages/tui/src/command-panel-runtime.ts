import type { Writable } from "node:stream";
import type { TuiContext } from "./index.js";
import type { CommandPanelRow, CommandPanelView } from "./shell/types.js";
import { sanitizeDiagnosticText, sanitizeDisplayPaths, writeLine } from "./startup-runtime.js";

/**
 * D.13Q-UX Task Surface Maturity Sweep — 通用 CommandPanel 设置器。
 *
 * 高级 slash 命令（/mcp, /memory, /index status, /cache, /background, /job,
 * /plugins, /skills, /remote, /doctor, /model 等）的默认输出应走这条路径，
 * 让命令结果落到独立面板，不污染 transcript / assistant_text 流。
 *
 * - ink session（context.isInkSession === true）走 commandPanelState 路径，
 *   shell.rerender 由调用栈外面统一触发。
 * - 非 ink（plain TUI / 非交互）走 writeDiagnosticLine fallback：把 panel
 *   的 summary + sections 拼成可读多行文本，保留原行为。
 *
 * 调用方应当只把"用户面向"的关键状态填进 panel；guard / runtime / binary /
 * source / version / schemaLoaded / trustLevel / endpoint 等内部字段一律
 * 不进 summary / sections，要么入 detailsText，要么仅在 doctor 子命令路径上输出。
 */
/**
 * D.13Q-UX Task Surface Maturity Sweep — explicit /details panel 装配器。
 *
 * 把 lastFullOutput / evidence / background 装配成一个 CommandPanel detailsText
 * 视图，供显式 /details slash 命令和测试使用。Ctrl+O 不走这里；它只切换
 * transcript/message block 的 verbose 展开态。
 *
 * 返回 undefined 表示三类内容都为空 —— 调用方走 notifications 轻提示。
 */
export function buildExplicitDetailsCommandPanel(
  context: TuiContext,
): CommandPanelView | undefined {
  const isEn = context.language === "en-US";
  const hasOutput = Boolean(context.lastFullOutput);
  const hasCompact = Boolean(
    context.cache.deepCompact || context.cache.compactProjection || context.cache.compactFailure,
  );
  const evidenceCount = context.evidence.length;
  const backgroundCount = context.backgroundTasks.length;
  if (!hasOutput && !hasCompact && evidenceCount === 0 && backgroundCount === 0) {
    return undefined;
  }
  // D.14D — summary-first details viewer。主屏（summary + sections）只展示人话
  // 摘要与计数，绝不泄漏内部 id / kind / source / path。完整明细（含 id / kind /
  // source）只进 detailsText，由 Ctrl+O 展开后才可见、可滚动。分区：最近输出 /
  // 证据 / 后台 / 诊断。
  const sections: { title?: string; rows: string[] }[] = [];
  const detailsParts: string[] = [];

  // ── 分区 1：最近输出（完整正文只进 detailsText）──────────────────────────
  if (context.lastFullOutput) {
    const lineCount = context.lastFullOutput.split("\n").filter((l) => l.trim()).length;
    sections.push({
      title: isEn ? "Last output" : "最近输出",
      rows: [
        isEn
          ? `1 captured output (${lineCount} line${lineCount === 1 ? "" : "s"})`
          : `1 条最近输出（${lineCount} 行）`,
      ],
    });
    detailsParts.push(isEn ? "## Last output (full body)" : "## 最近输出（完整正文）");
    detailsParts.push(sanitizeDisplayPaths(context.lastFullOutput, context.projectPath));
  }

  // ── 分区 2：证据（主屏只给人话计数；id/kind/source 进 detailsText）──────────
  if (evidenceCount > 0) {
    sections.push({
      title: isEn ? `Evidence (${evidenceCount})` : `证据（${evidenceCount}）`,
      rows: [
        isEn
          ? `${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"} captured.`
          : `已记录 ${evidenceCount} 条证据。`,
      ],
    });
    detailsParts.push("");
    detailsParts.push(isEn ? "## Evidence" : "## 证据");
    for (const e of context.evidence.slice(0, 8)) {
      detailsParts.push(
        `- ${e.id} · ${e.kind} · ${sanitizeDisplayPaths(e.source, context.projectPath)}: ${sanitizeDisplayPaths(e.summary, context.projectPath)}`,
      );
    }
    if (evidenceCount > 8) {
      detailsParts.push(
        isEn ? `… and ${evidenceCount - 8} more` : `… 还有 ${evidenceCount - 8} 条`,
      );
    }
  }

  // ── 分区 3：后台任务（主屏只给运行/失败/已结束计数；id 进 detailsText）──────
  if (backgroundCount > 0) {
    const running = context.backgroundTasks.filter((t) => t.status === "running").length;
    const failed = context.backgroundTasks.filter((t) => t.status === "failed").length;
    const others = backgroundCount - running - failed;
    const parts: string[] = [];
    if (running > 0) parts.push(isEn ? `${running} running` : `运行中 ${running}`);
    if (failed > 0) parts.push(isEn ? `${failed} failed` : `失败 ${failed}`);
    if (others > 0) parts.push(isEn ? `${others} other` : `其他 ${others}`);
    sections.push({
      title: isEn ? `Background (${backgroundCount})` : `后台任务（${backgroundCount}）`,
      rows: [parts.join(", ") || (isEn ? "tracked" : "已跟踪")],
    });
    detailsParts.push("");
    detailsParts.push(isEn ? "## Background tasks" : "## 后台任务");
    for (const t of context.backgroundTasks.slice(0, 8)) {
      detailsParts.push(
        `- ${t.id} · ${t.kind} · ${t.status}: ${sanitizeDisplayPaths(t.userVisibleSummary, context.projectPath)}`,
      );
    }
    if (backgroundCount > 8) {
      detailsParts.push(
        isEn ? `… and ${backgroundCount - 8} more` : `… 还有 ${backgroundCount - 8} 条`,
      );
    }
  }

  if (context.cache.compactProjection || context.cache.compactFailure) {
    const projection = context.cache.compactProjection;
    const failure = context.cache.compactFailure;
    sections.push({
      title: isEn ? "Context compact" : "上下文压缩",
      rows: [
        projection
          ? isEn
            ? `Last compact ${projection.createdAt}; pairing ${projection.toolPairingSafe ? "safe" : "unsafe"}`
            : `最近压缩 ${projection.createdAt}；pairing ${projection.toolPairingSafe ? "安全" : "不安全"}`
          : isEn
            ? "No successful compact projection"
            : "没有成功的 compact projection",
        failure
          ? isEn
            ? `Failure cooldown until ${failure.cooldownUntil}`
            : `失败冷却至 ${failure.cooldownUntil}`
          : isEn
            ? "No compact failure cooldown"
            : "没有 compact 失败冷却",
      ],
    });
    detailsParts.push("");
    detailsParts.push(isEn ? "## Context compact" : "## 上下文压缩");
    if (context.cache.deepCompact) {
      detailsParts.push(
        [
          `- deep: ${context.cache.deepCompact.id}`,
          "- deep scope: full transcript semantic compact",
          `- trigger: ${context.cache.deepCompact.trigger}`,
          `- evidence refs: ${context.cache.deepCompact.preservedEvidenceRefs.join(", ") || "none"}`,
          `- files: ${context.cache.deepCompact.preservedFiles.join(", ") || "none"}`,
          `- deep summary: ${sanitizeCompactDetailsText(context.cache.deepCompact.summary, context.projectPath)}`,
          "- pass evidence: no; context continuity only",
        ].join("\n"),
      );
    }
    if (projection) {
      detailsParts.push(
        [
          `- boundary: ${projection.boundaryId}`,
          `- pressure: ${projection.pressureRatio}`,
          "- scope: provider-visible recent context projection",
          `- discarded: ${sanitizeCompactDetailsText(projection.discardedRange, context.projectPath)}`,
          `- evidence refs: ${projection.evidenceRefs.join(", ") || "none"}`,
          `- summary: ${sanitizeCompactDetailsText(projection.summary, context.projectPath)}`,
        ].join("\n"),
      );
    }
    if (failure) {
      detailsParts.push(
        `- failure: ${failure.blocked ? "blocked" : "partial"}; ${sanitizeCompactDetailsText(failure.reason, context.projectPath)}; cooldown until ${failure.cooldownUntil}`,
      );
    }
  }
  if (
    context.cache.deepCompact &&
    !context.cache.compactProjection &&
    !context.cache.compactFailure
  ) {
    sections.push({
      title: isEn ? "Context compact" : "上下文压缩",
      rows: [
        isEn
          ? `Deep compact ${context.cache.deepCompact.createdAt}; scope full transcript semantic compact`
          : `Deep compact ${context.cache.deepCompact.createdAt}；scope full transcript semantic compact`,
      ],
    });
    detailsParts.push("");
    detailsParts.push(isEn ? "## Context compact" : "## 上下文压缩");
    detailsParts.push(
      [
        `- deep: ${context.cache.deepCompact.id}`,
        "- scope: full transcript semantic compact",
        `- trigger: ${context.cache.deepCompact.trigger}`,
        `- evidence refs: ${context.cache.deepCompact.preservedEvidenceRefs.join(", ") || "none"}`,
        `- files: ${context.cache.deepCompact.preservedFiles.join(", ") || "none"}`,
        `- summary: ${sanitizeCompactDetailsText(context.cache.deepCompact.summary, context.projectPath)}`,
        "- passEvidence: no; context continuity only",
      ].join("\n"),
    );
  }

  const summary: string[] = [];
  if (hasOutput) {
    summary.push(isEn ? "Latest output available." : "最近一次输出可展开。");
  }
  if (evidenceCount > 0) {
    summary.push(
      isEn
        ? `${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"}.`
        : `证据 ${evidenceCount} 条。`,
    );
  }
  if (backgroundCount > 0) {
    summary.push(
      isEn
        ? `${backgroundCount} background task${backgroundCount === 1 ? "" : "s"}.`
        : `后台任务 ${backgroundCount} 条。`,
    );
  }
  if (hasCompact) {
    summary.push(isEn ? "Context compact state available." : "上下文压缩状态可查看。");
  }
  return {
    title: isEn ? "Details" : "详情",
    tone: "neutral",
    summary,
    sections,
    actions: [
      "/details",
      ...(evidenceCount > 0 ? ["/details evidence <id>"] : []),
      ...(backgroundCount > 0 ? ["/details background <id>"] : []),
    ],
    detailsText: detailsParts.join("\n"),
    // D.14D — 默认折叠：主屏只显示 summary + 分区计数，panel 内显式展开
    // detailsText（含 id/source）。避免一上来就把内部 id / 完整正文糊一屏。
    expanded: false,
  };
}

function sanitizeCompactDetailsText(value: string, projectPath: string): string {
  return sanitizeDiagnosticText(sanitizeDisplayPaths(value, projectPath))
    .replace(
      /(api[_-]?key|apiKey|token|Authorization)(\s*[:=]\s*)(Bearer\s+)?[^\s;&,)}\]]+/giu,
      (_match, key: string, sep: string) => `${key}${sep}***`,
    )
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***");
}

export function showCommandPanel(
  context: TuiContext,
  output: Writable,
  panel: CommandPanelView,
): void {
  if (context.isInkSession) {
    context.commandPanelState = panel;
    return;
  }
  // Non-ink (plain TUI / non-interactive / tests): preserve the legacy full
  // text output so existing string-level assertions in index.test.ts and
  // scripted callers continue to see the unchanged formatXxxStatus body.
  // We write detailsText if present (which is the full legacy formatter
  // output), otherwise stitch summary + sections + actions for shorter
  // panels (/background empty, etc).
  if (panel.detailsText && panel.detailsText.trim().length > 0) {
    writeLine(output, panel.detailsText);
    return;
  }
  const lines: string[] = [];
  lines.push(`❯ ${panel.title}`);
  if (panel.summary && panel.summary.length > 0) {
    lines.push(...panel.summary);
  }
  if (panel.sections) {
    for (const section of panel.sections) {
      if (section.title) lines.push(section.title);
      lines.push(...section.rows.map((row) => getCommandPanelRowText(row)));
    }
  }
  if (panel.actions && panel.actions.length > 0) {
    for (const action of panel.actions) lines.push(`→ ${action}`);
  }
  writeLine(output, lines.join("\n"));
}

export function getCommandPanelRowText(row: CommandPanelRow): string {
  return typeof row === "string" ? row : row.text;
}

export function getCommandPanelSelectableRows(
  panel: CommandPanelView,
): Exclude<CommandPanelRow, string>[] {
  return (panel.sections ?? [])
    .flatMap((section) => section.rows)
    .filter(
      (row): row is Exclude<CommandPanelRow, string> =>
        typeof row !== "string" && row.selectable !== false && Boolean(row.taskRef),
    );
}
