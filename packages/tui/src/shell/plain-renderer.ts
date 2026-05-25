import type { Writable } from "node:stream";
import { type TerminalCapability, detectTerminalCapability } from "./terminal-capability.js";
import { charWidth, composerMaxWidth } from "./text-utils.js";
import { getStatusMarker } from "./theme.js";
import type { ProductBlockStatus, ShellViewModel } from "./types.js";

export function renderPlainShell(view: ShellViewModel, capability?: TerminalCapability): string {
  const cap = capability ?? detectTerminalCapability();
  if (view.viewMode === "task" || view.viewMode === "pending") {
    return renderPlainTask(view, cap);
  }
  return renderPlainHome(view, cap);
}

export function writePlainShell(output: Writable, view: ShellViewModel): void {
  output.write(`${renderPlainShell(view)}\n`);
}

// ---------------------------------------------------------------------------
// ANSI helpers — minimal, no dependencies, controlled by noColor
// ---------------------------------------------------------------------------

const ESC = "\x1B[";
const RESET = `${ESC}0m`;

function ansi(code: string, text: string, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}${code}m${text}${RESET}`;
}

function bold(text: string, noColor: boolean): string {
  return ansi("1", text, noColor);
}

function dim(text: string, noColor: boolean): string {
  return ansi("2", text, noColor);
}

function colorCyan(text: string, noColor: boolean): string {
  return ansi("36", text, noColor);
}

function colorYellow(text: string, noColor: boolean): string {
  return ansi("33", text, noColor);
}

function colorRed(text: string, noColor: boolean): string {
  return ansi("31", text, noColor);
}

function colorGreen(text: string, noColor: boolean): string {
  return ansi("32", text, noColor);
}

function colorBrightWhite(text: string, noColor: boolean): string {
  return ansi("97", text, noColor);
}

/** Color a status marker based on its semantic status. */
function colorStatus(marker: string, status: ProductBlockStatus, noColor: boolean): string {
  if (noColor) return marker;
  switch (status) {
    case "info":
      return colorCyan(marker, false);
    case "running":
      return colorYellow(marker, false);
    case "pass":
      return colorGreen(marker, false);
    case "partial":
      return colorYellow(marker, false);
    case "fail":
      return colorRed(marker, false);
    case "blocked":
      return colorYellow(marker, false);
  }
}

/** Color a risk label. */
function colorRisk(riskLabel: string, noColor: boolean): string {
  if (noColor) return `[${riskLabel}]`;
  switch (riskLabel) {
    case "HIGH":
      return colorRed(`[${riskLabel}]`, false);
    case "MEDIUM":
      return colorYellow(`[${riskLabel}]`, false);
    default:
      return colorCyan(`[${riskLabel}]`, false);
  }
}

// ---------------------------------------------------------------------------
// Home view
// ---------------------------------------------------------------------------

function renderPlainHome(view: ShellViewModel, capability: TerminalCapability): string {
  const noColor = view.themeMode === "no-color";
  const composerWidth = composerMaxWidth(view.width);

  const content: string[] = [];

  // Brand title — bold bright white, centered
  content.push(centerText(bold(colorBrightWhite("LingHun", noColor), noColor), composerWidth));

  // Accent underline — short centered line (12-16 chars)
  const accentLen = Math.min(16, Math.max(12, Math.floor(composerWidth * 0.2)));
  const accentChar = capability.unicodeBox ? "─" : "-";
  const accentLine = accentChar.repeat(accentLen);
  content.push(centerText(dim(accentLine, noColor), composerWidth));
  content.push("");

  // Vision — dim/muted, centered
  content.push(centerText(dim(view.homeVision, noColor), composerWidth));
  content.push("");

  // Composer box: top cyan line, placeholder hint, bottom cyan line
  // The placeholder is shown as a dim hint (no "> " prefix) because the real
  // readline prompt "  > " follows immediately after this render.
  // This avoids the "double input" visual where both a fake "> placeholder"
  // and the real "> " prompt appear.
  const lineChar = capability.unicodeBox ? "─" : "-";
  const composerLine = lineChar.repeat(composerWidth);
  content.push(colorCyan(composerLine, noColor));
  const hintLine = `    ${view.composer.placeholder}`;
  content.push(dim(hintLine, noColor));
  content.push(colorCyan(composerLine, noColor));
  content.push("");

  // Status tray — centered, below composer
  content.push(centerText(dim(formatStatusTray(view), noColor), composerWidth));

  // Setup hint (if needed)
  if (view.setupHint) {
    content.push("");
    content.push(centerText(dim(view.setupHint, noColor), composerWidth));
  }

  // Output blocks
  const blockLines = formatBlockLines(view, noColor);
  if (blockLines.length > 0) {
    content.push("");
    content.push(...blockLines);
  }

  // Limitations
  if (view.limitations.length > 0) {
    content.push("");
    content.push(...view.limitations.map((item) => `  ${dim(item, noColor)}`));
  }

  // Vertical centering: pad top so content sits in upper-center area
  const totalLines = content.length;
  const topPad = Math.max(0, Math.floor((view.height - totalLines) / 3));
  const padded = [...Array(topPad).fill(""), ...content];

  return padded.join("\n");
}

// ---------------------------------------------------------------------------
// Task view
// ---------------------------------------------------------------------------

function renderPlainTask(view: ShellViewModel, capability: TerminalCapability): string {
  const noColor = view.themeMode === "no-color";
  const composerWidth = composerMaxWidth(view.width);
  const separator = separatorLine(capability, composerWidth, noColor);

  const lines: string[] = [];

  // Compact top bar: bold brand + dim status
  const brandPart = bold(colorBrightWhite("LingHun", noColor), noColor);
  const statusPart = dim(formatStatusTray(view), noColor);
  lines.push(`${brandPart}  ${statusPart}`);
  lines.push(separator);

  // Activity indicator
  if (view.activity) {
    const statusKey =
      view.activity.phase === "completed"
        ? "info"
        : view.activity.phase === "error"
          ? "fail"
          : "running";
    const marker = getStatusMarker(statusKey, noColor);
    const coloredMarker = colorStatus(marker, statusKey, noColor);
    lines.push(`${coloredMarker} ${view.activity.text}`);
  }

  // Permission prompt with risk level — structured card
  if (view.permission) {
    const riskLabel = view.permission.risk.toUpperCase();
    const permBorder = capability.unicodeBox ? "\u2502" : "|";
    const coloredBorder = dim(colorCyan(permBorder, noColor), noColor);
    const permTop = capability.unicodeBox
      ? dim(colorCyan(`\u250C${"─".repeat(composerWidth - 2)}\u2510`, noColor), noColor)
      : dim(`+${"-".repeat(composerWidth - 2)}+`, noColor);
    const permBot = capability.unicodeBox
      ? dim(colorCyan(`\u2514${"─".repeat(composerWidth - 2)}\u2518`, noColor), noColor)
      : dim(`+${"-".repeat(composerWidth - 2)}+`, noColor);
    lines.push("");
    lines.push(permTop);
    lines.push(
      `${coloredBorder} ${bold(`[${view.permission.toolName}]`, noColor)} ${colorRisk(riskLabel, noColor)}`,
    );
    lines.push(`${coloredBorder} ${view.permission.reason}`);
    if (view.permission.scope.length > 0) {
      lines.push(`${coloredBorder}   ${dim(view.permission.scope.join(", "), noColor)}`);
    }
    lines.push(`${coloredBorder} ${dim(view.permission.hint, noColor)}`);
    lines.push(permBot);
  }

  // Output blocks
  const blockLines = formatBlockLines(view, noColor);
  if (blockLines.length > 0) {
    lines.push("");
    lines.push(...blockLines);
  }

  // Limitations
  if (view.limitations.length > 0) {
    lines.push("");
    lines.push(...view.limitations.map((item) => `  ${dim(item, noColor)}`));
  }

  // Bottom: just an empty line before real readline prompt (no separator)
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatBlockLines(view: ShellViewModel, noColor: boolean): string[] {
  return view.blocks.flatMap((block) => {
    const marker = getStatusMarker(block.status, noColor);
    const coloredMarker = colorStatus(marker, block.status, noColor);
    return [
      `${coloredMarker} ${bold(block.title, noColor)}`,
      `  ${dim(block.summary, noColor)}`,
      block.detail ? `  ${dim(block.detail, noColor)}` : undefined,
      block.nextAction ? `  ${colorCyan(block.nextAction, noColor)}` : undefined,
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
  if (line.length <= view.width) return line;
  if (view.width >= 60) {
    return fitStatusTrayLine(items, view.width);
  }
  const narrow = [items[0], items[1], items[2], items[4]];
  const narrowLine = narrow.join("  ");
  if (narrowLine.length <= view.width) return narrowLine;
  return fitStatusTrayLine(narrow, view.width);
}

function fitStatusTrayLine(items: string[], maxWidth: number): string {
  const sep = "  ";
  const separatorTotal = sep.length * (items.length - 1);
  const available = maxWidth - separatorTotal;
  const perItem = Math.max(6, Math.floor(available / items.length));
  return items
    .map((item) => (item.length > perItem ? `${item.slice(0, perItem - 1)}...` : item))
    .join(sep);
}

/** Separator line for sections. Dim in color mode. */
function separatorLine(capability: TerminalCapability, width: number, noColor: boolean): string {
  const char = capability.unicodeBox ? "\u2500" : "-";
  return dim(char.repeat(width), noColor);
}

/**
 * Compute the leading spaces for the readline prompt so it aligns with the
 * composer prompt line position in the Home view.
 * The prompt "> " sits at indent 2 inside the composer box (matching "  > placeholder").
 */
export function computeHomePromptPrefix(terminalWidth: number): string {
  // "  > " — 2 spaces indent then "> " is the readline prompt
  return "  ";
}

/** Center text within a given width using spaces. */
/** Strip ANSI escape sequences for visible length calculation. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching ESC control character
const ANSI_REGEX = /\x1B\[[0-9;]*m/g;

function centerText(text: string, width: number): string {
  const visible = text.replace(ANSI_REGEX, "");
  const visibleWidth = displayWidthPlain(visible);
  if (visibleWidth >= width) return text;
  const pad = Math.max(0, Math.floor((width - visibleWidth) / 2));
  return " ".repeat(pad) + text;
}

/** Compute display width accounting for CJK wide characters. */
function displayWidthPlain(value: string): number {
  let width = 0;
  for (const char of value) {
    width += charWidth(char);
  }
  return width;
}
