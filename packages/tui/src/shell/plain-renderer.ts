import type { Writable } from "node:stream";
import { isDiffFenceLanguage, renderPlainDiffLines } from "./diff-renderer.js";
import { type TerminalCapability, detectTerminalCapability } from "./terminal-capability.js";
import { displayWidth, taskComposerMaxWidth, wrapText } from "./text-utils.js";
import { getStatusMarker, createShellTheme } from "./theme.js";
import type { ShellTheme } from "./theme.js";
import type { ProductBlockStatus, ProductBlockViewModel, ShellViewModel } from "./types.js";

export function renderPlainShell(view: ShellViewModel, capability?: TerminalCapability): string {
  const cap = capability ?? detectTerminalCapability();
  return renderPlainTask(view, cap);
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

export function renderPlainMarkdownLines(
  text: string,
  noColor: boolean,
  options: {
    dimAll?: boolean;
    diagnostic?: boolean;
    error?: boolean;
    wrapWidth?: number;
    theme?: ShellTheme;
  } = {},
): string[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLang: string | undefined;
  let codeLines: string[] = [];
  const wrapWidth = Math.max(8, options.wrapWidth ?? 100);
  const applyTone = (line: string): string => {
    if (options.error) return colorRed(line, noColor);
    if (options.diagnostic) return colorCyan(line, noColor);
    if (options.dimAll) return dim(line, noColor);
    return line;
  };
  const flushCodeBlock = (): void => {
    if (isDiffFenceLanguage(codeLang)) {
      out.push(...renderPlainDiffLines(codeLines, { noColor, wrapWidth, theme: options.theme }));
      return;
    }
    for (const codeLine of codeLines) {
      for (const wrapped of wrapText(
        codeLine.length === 0 ? " " : codeLine,
        Math.max(8, wrapWidth - 4),
      )) {
        out.push(`${dim("  | ", noColor)}${dim(wrapped, noColor)}`);
      }
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const fence = raw.match(/^\s*```\s*([A-Za-z0-9_+-]*)\s*$/u);
    if (fence) {
      if (inCode) {
        flushCodeBlock();
        out.push(dim("  +", noColor));
        inCode = false;
        codeLang = undefined;
        codeLines = [];
      } else {
        inCode = true;
        codeLang = fence[1] || undefined;
        codeLines = [];
        out.push(dim(`  +${codeLang ? ` ${codeLang}` : ""}`, noColor));
      }
      continue;
    }
    if (!inCode) {
      const table = readMarkdownTable(lines, i);
      if (table) {
        out.push(...renderMarkdownTableLines(table, noColor, wrapWidth).map(applyTone));
        i = table.endIndex;
        continue;
      }
      out.push(...wrapText(raw, wrapWidth).map(applyTone));
      continue;
    }

    codeLines.push(raw);
  }
  if (inCode) {
    flushCodeBlock();
    out.push(dim("  +", noColor));
  }
  return out;
}

type MarkdownTableAlign = "left" | "center" | "right";

type MarkdownTable = {
  rows: string[][];
  aligns: MarkdownTableAlign[];
  endIndex: number;
};

function readMarkdownTable(lines: string[], startIndex: number): MarkdownTable | undefined {
  const header = parseMarkdownTableRow(lines[startIndex] ?? "");
  if (!header) return undefined;
  const aligns = parseMarkdownTableSeparator(lines[startIndex + 1] ?? "");
  if (!aligns || aligns.length !== header.length) return undefined;

  const rows = [header];
  let endIndex = startIndex + 1;
  for (let i = startIndex + 2; i < lines.length; i += 1) {
    const row = parseMarkdownTableRow(lines[i] ?? "");
    if (!row || row.length !== header.length) break;
    rows.push(row);
    endIndex = i;
  }
  return { rows, aligns, endIndex };
}

function parseMarkdownTableRow(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return undefined;
  const body = trimmed.replace(/^\|/u, "").replace(/\|$/u, "");
  const cells = body.split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : undefined;
}

function parseMarkdownTableSeparator(line: string): MarkdownTableAlign[] | undefined {
  const cells = parseMarkdownTableRow(line);
  if (!cells) return undefined;
  const aligns: MarkdownTableAlign[] = [];
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/u.test(cell)) return undefined;
    if (cell.startsWith(":") && cell.endsWith(":")) {
      aligns.push("center");
    } else if (cell.endsWith(":")) {
      aligns.push("right");
    } else {
      aligns.push("left");
    }
  }
  return aligns;
}

function renderMarkdownTableLines(table: MarkdownTable, noColor: boolean, wrapWidth: number): string[] {
  const widths = table.rows[0]?.map((_cell, column) =>
    Math.max(...table.rows.map((row) => displayWidth(row[column] ?? ""))),
  );
  if (!widths || widths.length === 0) return [];
  const separator = `| ${widths.map((width) => "-".repeat(Math.max(3, width))).join(" | ")} |`;
  const tableWidth = Math.max(separator.length, displayWidth(separator));
  if (tableWidth > wrapWidth) {
    const headers = table.rows[0] ?? [];
    return table.rows.slice(1).flatMap((row, rowIndex) => {
      const rendered = row.flatMap((cell, column) => {
        const label = headers[column] ?? `#${column + 1}`;
        const prefix = `${label}: `;
        return wrapText(cell || " ", Math.max(8, wrapWidth - displayWidth(prefix))).map(
          (wrapped, lineIndex) => `${lineIndex === 0 ? prefix : " ".repeat(displayWidth(prefix))}${wrapped}`,
        );
      });
      return rowIndex === 0 ? rendered : ["", ...rendered];
    });
  }
  return table.rows.flatMap((row, rowIndex) => {
    const isHeader = rowIndex === 0;
    const rendered = `| ${row
      .map((cell, column) => {
        const align = isHeader ? "center" : table.aligns[column] ?? "left";
        const padded = padTableCell(cell, widths[column] ?? 0, align);
        return isHeader ? bold(padded, noColor) : padded;
      })
      .join(" | ")} |`;
    return isHeader ? [rendered, dim(separator, noColor)] : [rendered];
  });
}

function padTableCell(text: string, width: number, align: MarkdownTableAlign): string {
  const remaining = Math.max(0, width - displayWidth(text));
  if (align === "right") return `${" ".repeat(remaining)}${text}`;
  if (align === "center") {
    const left = Math.floor(remaining / 2);
    return `${" ".repeat(left)}${text}${" ".repeat(remaining - left)}`;
  }
  return `${text}${" ".repeat(remaining)}`;
}

function renderPlainTask(view: ShellViewModel, capability: TerminalCapability): string {
  const noColor = view.themeMode === "no-color";
  const theme = createShellTheme(noColor);
  const composerWidth = taskComposerMaxWidth(view.width);
  const separator = separatorLine(capability, composerWidth, noColor);

  const lines: string[] = [];

  // Compact top bar: keep Task mode free of the full StatusTray; runtime
  // metadata belongs in the bottom task footer or explicit status/details views.
  const brandPart = bold(colorBrightWhite("LingHun", noColor), noColor);
  lines.push(brandPart);
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
  const blockLines = formatBlockLines(view, noColor, theme);
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

function formatBlockLines(view: ShellViewModel, noColor: boolean, theme: ShellTheme): string[] {
  const result: string[] = [];
  let prevKind: string | undefined;
  for (const block of view.blocks) {
    const blockLines = formatSingleBlock(block, view, noColor, theme);
    if (blockLines.length === 0) continue;
    // Inter-block spacing: empty line between assistant_text ↔ tool_result
    // transitions and between consecutive tool_result blocks, giving visual
    // separation without wasting vertical space on tight tool sequences.
    const curKind = block.messageKind ?? block.kind;
    if (prevKind && curKind) {
      const prevIsTool = prevKind.startsWith("tool_result");
      const curIsTool = curKind.startsWith("tool_result");
      const prevIsAssistant = prevKind === "assistant_text";
      const curIsAssistant = curKind === "assistant_text";
      if (
        (prevIsAssistant && curIsTool) ||
        (prevIsTool && curIsAssistant) ||
        (prevIsTool && curIsTool)
      ) {
        result.push("");
      }
    }
    result.push(...blockLines);
    prevKind = curKind;
  }
  return result;
}

function formatSingleBlock(
  block: ProductBlockViewModel,
  view: ShellViewModel,
  noColor: boolean,
  theme: ShellTheme,
): string[] {
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
      messageKind !== "assistant_thinking" &&
      messageKind !== "compact_boundary"
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
      const isToolSuccess = messageKind === "tool_result_success";
      const renderedMessage = renderPlainMarkdownLines(body, noColor, {
        dimAll,
        diagnostic: isDiagnostic,
        theme,
        wrapWidth: Math.max(8, view.width - 6),
      });
      const out: string[] = isLocalOutput || isToolSuccess
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

    if (messageKind === "compact_boundary") {
      return [`${dim(`\u273b ${block.title}`, noColor)}`];
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
        out.push(...renderPlainMarkdownLines(body, noColor, {
          error: true,
          theme,
          wrapWidth: Math.max(8, view.width - 6),
        }));
      }
      if (nextAction) out.push(`  ${dim(nextAction, noColor)}`);
      if (block.retryAttempt && block.retryAttempt > 0 && block.retryMax) {
        const hint =
          view.language === "en-US"
            ? `Automatic retry finished (${block.retryAttempt}/${block.retryMax}); the request still did not complete.`
            : `已自动重试 ${block.retryAttempt}/${block.retryMax} 后仍未完成。`;
        out.push(dim(hint, noColor));
      }
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
}

/** Separator line for sections. Dim in color mode. */
function separatorLine(capability: TerminalCapability, width: number, noColor: boolean): string {
  const char = capability.unicodeBox ? "\u2500" : "-";
  return dim(char.repeat(width), noColor);
}

export function computePlainPromptPrefix(terminalWidth: number): string {
  void terminalWidth;
  return "  ";
}
