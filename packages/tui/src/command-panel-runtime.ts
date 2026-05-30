import type { Writable } from "node:stream";
import type { TuiContext } from "./index.js";
import type { CommandPanelView } from "./shell/types.js";
import { writeLine } from "./startup-runtime.js";

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
 * 不进 summary / sections，要么入 detailsText（Ctrl+O 展开），要么仅在
 * doctor 子命令路径上输出。
 */
/**
 * D.13Q-UX Task Surface Maturity Sweep — Ctrl+O fallback 装配器。
 *
 * 当 commandPanel 未打开、最近 block 也没有可展开 fullText 时，把
 * lastFullOutput / evidence / background 装配成一个 CommandPanel detailsText
 * 视图，让 Ctrl+O **始终走 panel 路径**，绝不调 handleDetailsCommand
 * （那会 writeLine 进 transcript，污染 lastFullOutput 并出现 "Linghun details"
 * 计数行）。
 *
 * 返回 undefined 表示三类内容都为空 —— 调用方走 notifications 轻提示。
 */
export function buildToggleDetailsCommandPanel(
  context: TuiContext,
): CommandPanelView | undefined {
  const isEn = context.language === "en-US";
  const hasOutput = Boolean(context.lastFullOutput);
  const evidenceCount = context.evidence.length;
  const backgroundCount = context.backgroundTasks.length;
  if (!hasOutput && evidenceCount === 0 && backgroundCount === 0) {
    return undefined;
  }
  const sections: { title?: string; rows: string[] }[] = [];
  const detailsParts: string[] = [];
  if (context.lastFullOutput) {
    const header = isEn ? "Latest output (full body):" : "最近一次输出（完整正文）：";
    detailsParts.push(header);
    detailsParts.push(context.lastFullOutput);
  }
  if (evidenceCount > 0) {
    sections.push({
      title: isEn ? `Evidence (${evidenceCount})` : `证据（${evidenceCount}）`,
      rows: context.evidence
        .slice(0, 5)
        .map((e) => `${e.id} · ${e.kind} · ${e.source}`),
    });
    detailsParts.push("");
    detailsParts.push(isEn ? "Recent evidence:" : "最近证据：");
    for (const e of context.evidence.slice(0, 5)) {
      detailsParts.push(`  - ${e.id} ${e.kind} ${e.source}: ${e.summary}`);
    }
  }
  if (backgroundCount > 0) {
    sections.push({
      title: isEn ? `Background (${backgroundCount})` : `后台任务（${backgroundCount}）`,
      rows: context.backgroundTasks
        .slice(0, 5)
        .map((t) => `${t.id} · ${t.kind} · ${t.status}`),
    });
    detailsParts.push("");
    detailsParts.push(isEn ? "Recent background:" : "最近后台：");
    for (const t of context.backgroundTasks.slice(0, 5)) {
      detailsParts.push(`  - ${t.id} ${t.kind} ${t.status}: ${t.userVisibleSummary}`);
    }
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
    expanded: true,
  };
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
      lines.push(...section.rows);
    }
  }
  if (panel.actions && panel.actions.length > 0) {
    for (const action of panel.actions) lines.push(`→ ${action}`);
  }
  writeLine(output, lines.join("\n"));
}


