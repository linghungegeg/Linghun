import type { Writable } from "node:stream";
import { getStatusMarker } from "./theme.js";
import type { ShellViewModel } from "./types.js";

export function renderPlainShell(view: ShellViewModel): string {
  const noColor = view.themeMode === "no-color";
  const separator = noColor ? "----" : "────";
  const blockLines = view.blocks.flatMap((block) => {
    const marker = getStatusMarker(block.status, noColor);
    return [
      `${marker} ${block.title}`,
      `  ${block.summary}`,
      block.detail ? `  ${block.detail}` : undefined,
      block.nextAction ? `  ${block.nextAction}` : undefined,
    ].filter((line): line is string => Boolean(line));
  });
  const lines = [
    view.brand,
    view.homeVision,
    ...(view.language !== "en-US" ? [view.homeVisionEn] : []),
    formatStatusTray(view),
    ...(view.setupHint ? [view.setupHint] : []),
    ...(blockLines.length > 0 ? [separator, ...blockLines] : []),
    separator,
    `${view.composer.prompt}> ${view.composer.placeholder}`,
    view.composer.hint,
    ...view.limitations.map((item) => `- ${item}`),
  ];
  return lines.join("\n");
}

export function writePlainShell(output: Writable, view: ShellViewModel): void {
  output.write(`${renderPlainShell(view)}\n`);
}

function formatStatusTray(view: ShellViewModel): string {
  const items = [
    view.status.project,
    view.status.model,
    view.status.permission,
    view.status.trust,
    view.status.index,
    view.status.background,
  ];
  const line = items.join(" · ");
  if (view.width >= 60) return line;
  return items.slice(0, 4).join(" · ");
}
