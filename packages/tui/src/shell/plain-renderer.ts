import type { Writable } from "node:stream";
import { type TerminalCapability, detectTerminalCapability } from "./terminal-capability.js";
import { charWidth, composerMaxWidth, taskComposerMaxWidth, wrapText } from "./text-utils.js";
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

function hasHiddenContent(block: ShellViewModel["blocks"][number], renderedBody?: string): boolean {
  const fullText = (block.fullText ?? "").trim();
  const summary = (block.summary ?? "").trim();
  if (!fullText) return false;
  if (renderedBody?.trim() === fullText) return false;
  if (!summary) return fullText.length > 0;
  const nonEmptyLines = fullText.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
  return nonEmptyLines >= 2 || fullText.length > summary.length + 16;
}

function visibleNextAction(
  block: ShellViewModel["blocks"][number],
  renderedBody?: string,
): string | undefined {
  if (!block.nextAction) return undefined;
  if (!/Ctrl\+O/i.test(block.nextAction)) return block.nextAction;
  return hasHiddenContent(block, renderedBody) ? block.nextAction : undefined;
}

function messageBody(
  block: ShellViewModel["blocks"][number],
  nextAction: string | undefined,
): string {
  if (nextAction && /Ctrl\+O/i.test(nextAction) && block.ctrlOCollapsed) {
    return (block.summary ?? "").trim();
  }
  return (block.fullText ?? block.summary ?? "").trim();
}

function renderPlainMarkdownLines(
  text: string,
  noColor: boolean,
  options: { dimAll?: boolean; diagnostic?: boolean; error?: boolean } = {},
): string[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLang: string | undefined;
  const applyTone = (line: string): string => {
    if (options.error) return colorRed(line, noColor);
    if (options.diagnostic) return colorCyan(line, noColor);
    if (options.dimAll) return dim(line, noColor);
    return line;
  };

  for (const raw of lines) {
    const fence = raw.match(/^\s*```\s*([A-Za-z0-9_+-]*)\s*$/u);
    if (fence) {
      if (inCode) {
        out.push(dim("  +", noColor));
        inCode = false;
        codeLang = undefined;
      } else {
        inCode = true;
        codeLang = fence[1] || undefined;
        out.push(dim(`  +${codeLang ? ` ${codeLang}` : ""}`, noColor));
      }
      continue;
    }
    if (!inCode) {
      out.push(...wrapText(raw, 100).map(applyTone));
      continue;
    }

    const isDiff = codeLang === "diff" || codeLang === "patch";
    for (const wrapped of wrapText(raw.length === 0 ? " " : raw, 96)) {
      const wrappedBody =
        isDiff && wrapped.startsWith("+") && !wrapped.startsWith("+++")
          ? colorGreen(wrapped, noColor)
          : isDiff && wrapped.startsWith("-") && !wrapped.startsWith("---")
            ? colorRed(wrapped, noColor)
            : dim(wrapped, noColor);
      out.push(`${dim("  | ", noColor)}${wrappedBody}`);
    }
  }
  if (inCode) out.push(dim("  +", noColor));
  return out;
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
  const composerWidth = taskComposerMaxWidth(view.width);
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

  if (view.taskFooter?.workspaceStatus) {
    lines.push(dim(view.taskFooter.workspaceStatus, noColor));
  }
  if (view.taskFooter?.runtimeStatus) {
    lines.push(dim(view.taskFooter.runtimeStatus, noColor));
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
    // Command transcript row — slash command 提交后作为独立 `❯ /command` 行进入
    // task transcript（plain 渲染同步 Ink ProductBlock 的 command 分支）。
    if (block.kind === "command") {
      const isUserText = block.messageKind === "user_text";
      const marker = isUserText ? "\u2502" : "\u276F";
      const title = isUserText ? block.title : colorCyan(block.title, noColor);
      if (isUserText) {
        const body = block.fullText ?? block.title;
        return wrapText(body, Math.max(8, view.width - 2)).map((line, index) =>
          index === 0 ? `${dim(marker, noColor)} ${line}` : `  ${line}`,
        );
      }
      return [`${dim(marker, noColor)} ${title}`];
    }

    // D.13Q-UX \u2014\u2014 \u6D88\u606F\u8BED\u4E49 block \u5728 plain \u6A21\u5F0F\u6309\u591A\u884C\u539F\u6837\u8F93\u51FA\u3002
    // assistant_text \u9ED8\u8BA4\u8272\uFF08\u4E0D dim\uFF09\uFF0C\u4FDD\u7559\u6BB5\u843D\u4E0E\u5217\u8868\uFF1Btool_result_cancelled /
    // tool_result_rejected \u6574\u4F53 dim\uFF1Bdiagnostic \u7528 cyan\uFF1Blocal_command_output
    // \u7ED9\u6BCF\u884C\u52A0 \u23BF \u524D\u7F00\uFF08dim\uFF09\u540E\u9ED8\u8BA4\u8272\u3002
    const messageKind = block.messageKind;
    if (
      messageKind &&
      messageKind !== "tool_result_error" &&
      messageKind !== "assistant_thinking"
    ) {
      const previewBody = messageBody(block, block.nextAction);
      const nextAction = visibleNextAction(block, previewBody);
      const body = messageBody(block, nextAction);
      if (!body) return [];
      const lines = body.split("\n");
      const dimAll =
        messageKind === "tool_result_cancelled" || messageKind === "tool_result_rejected";
      const isDiagnostic = messageKind === "diagnostic";
      const isLocalOutput = messageKind === "local_command_output";
      const renderedMessage = renderPlainMarkdownLines(body, noColor, {
        dimAll,
        diagnostic: isDiagnostic,
      });
      const out: string[] = isLocalOutput
        ? renderedMessage.map((line) => `${dim("  \u23BF  ", noColor)}${line}`)
        : renderedMessage;
      if (nextAction) {
        out.push(`  ${dim(nextAction, noColor)}`);
      }
      return out;
    }

    if (messageKind === "assistant_thinking") {
      const previewBody = messageBody(block, block.nextAction);
      const nextAction = visibleNextAction(block, previewBody);
      const body = messageBody(block, nextAction);
      if (!body) return [];
      return [`${dim("\u2234 ", noColor)}${dim(body, noColor)}`];
    }

    if (messageKind === "tool_result_error") {
      const previewBody = messageBody(block, block.nextAction);
      const nextAction = visibleNextAction(block, previewBody);
      const body = messageBody(block, nextAction);
      const out: string[] = [];
      const failMarker = getStatusMarker("fail", noColor);
      const coloredFailMarker = colorStatus(failMarker, "fail", noColor);
      if (block.title && block.title.trim().length > 0) {
        out.push(`${coloredFailMarker} ${colorRed(block.title, noColor)}`);
      } else {
        out.push(coloredFailMarker);
      }
      if (body) {
        out.push(...renderPlainMarkdownLines(body, noColor, { error: true }));
      }
      if (nextAction) out.push(`  ${dim(nextAction, noColor)}`);
      return out;
    }

    const renderedBody = block.fullText ? block.summary : undefined;
    const nextAction = visibleNextAction(block, renderedBody);
    const marker = getStatusMarker(block.status, noColor);
    const coloredMarker = colorStatus(marker, block.status, noColor);
    return [
      `${coloredMarker} ${bold(block.title, noColor)}`,
      `  ${dim(block.summary, noColor)}`,
      block.detail ? `  ${dim(block.detail, noColor)}` : undefined,
      nextAction ? `  ${colorCyan(nextAction, noColor)}` : undefined,
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
