import type { Writable } from "node:stream";
import { brandWordmark, composerMaxWidth, lineChar } from "./text-utils.js";
import { getStatusMarker } from "./theme.js";
import type { ShellViewModel } from "./types.js";

export function renderPlainShell(view: ShellViewModel): string {
  if (view.viewMode === "task" || view.viewMode === "pending") {
    return renderPlainTask(view);
  }
  return renderPlainHome(view);
}

export function writePlainShell(output: Writable, view: ShellViewModel): void {
  output.write(`${renderPlainShell(view)}\n`);
}

function renderPlainHome(view: ShellViewModel): string {
  const noColor = view.themeMode === "no-color";
  const separator = noColor ? "----" : "────";
  const blockLines = formatBlockLines(view, noColor);
  const composerWidth = composerMaxWidth(view.width);
  const composerLine = lineChar(noColor).repeat(composerWidth);
  const lines = [
    ...brandWordmark(noColor, view.width),
    "",
    view.homeVision,
    ...(view.setupHint ? [view.setupHint] : []),
    composerLine,
    `> ${view.composer.placeholder}`,
    composerLine,
    formatStatusTray(view),
    ...(blockLines.length > 0 ? [separator, ...blockLines] : []),
    ...view.limitations.map((item) => `- ${item}`),
  ];
  return lines.join("\n");
}

function renderPlainTask(view: ShellViewModel): string {
  const noColor = view.themeMode === "no-color";
  const separator = noColor ? "----" : "────";
  const composerWidth = composerMaxWidth(view.width);
  const composerLine = lineChar(noColor).repeat(composerWidth);
  const blockLines = formatBlockLines(view, noColor);

  const lines: string[] = [];

  // Compact top bar
  lines.push(`${view.brand}  ${formatStatusTray(view)}`);
  lines.push(separator);

  // Activity indicator
  if (view.activity) {
    const marker = getStatusMarker(
      view.activity.phase === "completed"
        ? "pass"
        : view.activity.phase === "error"
          ? "fail"
          : "running",
      noColor,
    );
    lines.push(`${marker} ${view.activity.text}`);
  }

  // Permission prompt with risk level
  if (view.permission) {
    const riskLabel = view.permission.risk.toUpperCase();
    lines.push("");
    lines.push(`[${view.permission.toolName}] [${riskLabel}] ${view.permission.reason}`);
    if (view.permission.scope.length > 0) {
      lines.push(`  ${view.permission.scope.join(", ")}`);
    }
    lines.push(`  ${view.permission.hint}`);
  }

  // Output blocks
  if (blockLines.length > 0) {
    lines.push(separator);
    lines.push(...blockLines);
  }

  // Limitations
  if (view.limitations.length > 0) {
    lines.push(...view.limitations.map((item) => `- ${item}`));
  }

  // Composer — plain renderer shows prompt marker without fake cursor
  // (native cursor is handled by terminal itself in plain mode)
  lines.push(composerLine);
  lines.push(`> ${view.composer.placeholder}`);
  lines.push(composerLine);

  return lines.join("\n");
}

function formatBlockLines(view: ShellViewModel, noColor: boolean): string[] {
  return view.blocks.flatMap((block) => {
    const marker = getStatusMarker(block.status, noColor);
    return [
      `${marker} ${block.title}`,
      `  ${block.summary}`,
      block.detail ? `  ${block.detail}` : undefined,
      block.nextAction ? `  ${block.nextAction}` : undefined,
    ].filter((line): line is string => Boolean(line));
  });
}

function formatStatusTray(view: ShellViewModel): string {
  const items = [
    view.status.project,
    view.status.model,
    view.status.permission,
    view.status.index,
    view.status.background,
  ];
  const line = items.join("  ");
  // P3-2: total length control — truncate items if they exceed width
  if (line.length <= view.width) return line;
  if (view.width >= 60) {
    // Fit by truncating individual items
    return fitStatusTrayLine(items, view.width);
  }
  // Narrow: keep project, model, permission, background (drop index if needed)
  const narrow = [items[0], items[1], items[2], items[4]];
  const narrowLine = narrow.join("  ");
  if (narrowLine.length <= view.width) return narrowLine;
  return fitStatusTrayLine(narrow, view.width);
}

function fitStatusTrayLine(items: string[], maxWidth: number): string {
  const separator = "  ";
  const separatorTotal = separator.length * (items.length - 1);
  const available = maxWidth - separatorTotal;
  const perItem = Math.max(6, Math.floor(available / items.length));
  return items
    .map((item) => (item.length > perItem ? `${item.slice(0, perItem - 1)}…` : item))
    .join(separator);
}
