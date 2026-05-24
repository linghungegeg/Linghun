import type { Writable } from "node:stream";
import type { ShellViewModel } from "./types.js";

export function renderPlainShell(view: ShellViewModel): string {
  const noColor = view.themeMode === "no-color";
  const separator = noColor ? "----" : "────";
  const lines = [
    view.homeTitle,
    view.homeSummary,
    formatStatusTray(view),
    separator,
    ...view.blocks.flatMap((block) => {
      const marker = noColor ? `[${block.status.toUpperCase()}]` : "•";
      return [
        `${marker} ${block.title}`,
        `  ${block.summary}`,
        block.detail ? `  ${block.detail}` : undefined,
        block.nextAction ? `  ${block.nextAction}` : undefined,
      ].filter((line): line is string => Boolean(line));
    }),
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
    view.status.model,
    view.status.mode,
    view.status.trust,
    view.status.index,
    view.status.cache,
    view.status.background,
  ];
  const line = items.join(" · ");
  if (view.width >= 60) return line;
  return items.slice(0, 4).join(" · ");
}
