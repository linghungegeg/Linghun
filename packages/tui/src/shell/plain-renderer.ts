import type { Writable } from "node:stream";
import { brandWordmark, composerMaxWidth, lineChar } from "./text-utils.js";
import { getStatusMarker } from "./theme.js";
import type { ShellViewModel } from "./types.js";

export function renderPlainShell(view: ShellViewModel): string {
  if (view.viewMode === "task") {
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
    ...brandWordmark(noColor),
    view.homeVision,
    ...(view.setupHint ? [view.setupHint] : []),
    composerLine,
    view.composer.placeholder,
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

  // Permission prompt
  if (view.permission) {
    lines.push("");
    lines.push(`[${view.permission.toolName}] ${view.permission.reason}`);
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

  // Composer
  lines.push(composerLine);
  lines.push(view.composer.placeholder);
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
  if (view.width >= 60) return line;
  return items.slice(0, 4).join("  ");
}
