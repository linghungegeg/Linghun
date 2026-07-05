import type { Writable } from "node:stream";
import { type Token, type Tokens, lexer } from "marked";
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

type PlainMarkdownRenderOptions = {
  dimAll?: boolean;
  diagnostic?: boolean;
  error?: boolean;
  wrapWidth?: number;
  theme?: ShellTheme;
};

export function renderPlainMarkdownLines(
  text: string,
  noColor: boolean,
  options: PlainMarkdownRenderOptions = {},
): string[] {
  const normalized = text.replace(/\r/g, "");
  if (!normalized) return [];
  const wrapWidth = Math.max(8, options.wrapWidth ?? 100);
  const tone = createPlainTone(noColor, options);
  const rendered = renderPlainMarkdownTokens(lexer(normalized), noColor, wrapWidth, options);
  return trimOuterBlankLines(rendered).map(tone);
}

function createPlainTone(
  noColor: boolean,
  options: PlainMarkdownRenderOptions,
): (line: string) => string {
  return (line: string): string => {
    if (options.error) return colorRed(line, noColor);
    if (options.diagnostic) return colorCyan(line, noColor);
    if (options.dimAll) return dim(line, noColor);
    return line;
  };
}

function renderPlainMarkdownTokens(
  tokens: Token[],
  noColor: boolean,
  wrapWidth: number,
  options: PlainMarkdownRenderOptions,
): string[] {
  const out: string[] = [];
  tokens.forEach((token) => {
    const next = renderPlainMarkdownToken(token, noColor, wrapWidth, options);
    appendBlockLines(out, next);
  });
  return out;
}

function appendBlockLines(out: string[], next: string[]): void {
  if (next.length === 0) return;
  if (out.length > 0 && out[out.length - 1] !== "" && next[0] !== "") out.push("");
  out.push(...next);
}

function renderPlainMarkdownToken(
  token: Token,
  noColor: boolean,
  wrapWidth: number,
  options: PlainMarkdownRenderOptions,
): string[] {
  switch (token.type) {
    case "space":
      return [""];
    case "heading": {
      const heading = token as Tokens.Heading;
      return wrapText(`${"#".repeat(heading.depth)} ${plainInlineText(heading.text, noColor)}`, wrapWidth).map(
        (line) => bold(colorCyan(line, noColor), noColor),
      );
    }
    case "paragraph":
    case "text":
      return wrapText(plainTokenText(token, noColor), wrapWidth);
    case "blockquote":
      return renderPlainBlockquote(token as Tokens.Blockquote, noColor, wrapWidth, options);
    case "list":
      return renderPlainList(token as Tokens.List, noColor, wrapWidth);
    case "code":
      return renderPlainCodeToken(token as Tokens.Code, noColor, wrapWidth, options);
    case "table":
      return renderPlainTableToken(token as Tokens.Table, noColor, wrapWidth);
    case "hr":
      return [dim("-".repeat(Math.min(wrapWidth, 40)), noColor)];
    default:
      return wrapText(plainTokenText(token, noColor), wrapWidth);
  }
}

function plainTokenText(token: Token, noColor: boolean): string {
  const maybeInline = token as { text?: unknown; tokens?: unknown };
  const text = typeof maybeInline.text === "string" ? maybeInline.text : token.raw ?? "";
  return plainInlineText(text, noColor, maybeInline.tokens);
}

function plainInlineText(text: string, noColor: boolean, tokens?: unknown): string {
  if (Array.isArray(tokens)) return tokens.map((token) => renderPlainInlineToken(token, noColor)).join("");
  return text;
}

function renderPlainInlineToken(token: unknown, noColor: boolean): string {
  if (!isInlineRecord(token)) return "";
  switch (token.type) {
    case "text":
      return plainInlineText(token.text ?? token.raw ?? "", noColor, token.tokens);
    case "codespan":
      return colorCyan(`\`${token.text ?? token.raw ?? ""}\``, noColor);
    case "strong":
      return bold(plainInlineText(token.text ?? "", noColor, token.tokens), noColor);
    case "em":
      return plainInlineText(token.text ?? "", noColor, token.tokens);
    case "link": {
      const label = plainInlineText(token.text ?? "", noColor, token.tokens);
      const href = typeof token.href === "string" ? token.href : "";
      return href && href !== label ? colorCyan(`${label} (${href})`, noColor) : colorCyan(label, noColor);
    }
    case "br":
      return "\n";
    default:
      return plainInlineText(token.text ?? token.raw ?? "", noColor, token.tokens);
  }
}

type InlineRecord = {
  type?: string;
  raw?: string;
  text?: string;
  href?: string;
  tokens?: unknown;
};

function isInlineRecord(value: unknown): value is InlineRecord {
  return typeof value === "object" && value !== null;
}

function renderPlainBlockquote(
  token: Tokens.Blockquote,
  noColor: boolean,
  wrapWidth: number,
  options: PlainMarkdownRenderOptions,
): string[] {
  const quoteWidth = Math.max(8, wrapWidth - 2);
  const quoteLines = renderPlainMarkdownTokens(token.tokens ?? lexer(token.text), noColor, quoteWidth, options);
  return trimOuterBlankLines(quoteLines).map((line) => `${dim("> ", noColor)}${line}`);
}

function renderPlainList(token: Tokens.List, noColor: boolean, wrapWidth: number): string[] {
  const out: string[] = [];
  token.items.forEach((item, index) => {
    const marker = token.ordered
      ? `${Number(token.start || 1) + index}.`
      : item.task
        ? item.checked
          ? "[x]"
          : "[ ]"
        : "-";
    const prefix = `${marker} `;
    const body = plainInlineText(item.text.replace(/\n+/gu, " "), noColor, item.tokens);
    const wrapped = wrapText(body || " ", Math.max(8, wrapWidth - displayWidth(prefix)));
    wrapped.forEach((line, lineIndex) => {
      out.push(`${lineIndex === 0 ? dim(prefix, noColor) : " ".repeat(displayWidth(prefix))}${line}`);
    });
  });
  return out;
}

function renderPlainCodeToken(
  token: Tokens.Code,
  noColor: boolean,
  wrapWidth: number,
  options: PlainMarkdownRenderOptions,
): string[] {
  const lang = normalizeFenceLanguage(token.lang);
  if (isMarkdownFenceLanguage(lang) && hasMarkdownStructure(token.text)) {
    return renderPlainMarkdownLines(token.text, noColor, { ...options, wrapWidth });
  }
  if (isDiffFenceLanguage(lang)) {
    return renderPlainDiffLines(token.text.split("\n"), { noColor, wrapWidth, theme: options.theme });
  }
  const out = [dim(`  +${lang ? ` ${lang}` : ""}`, noColor)];
  for (const codeLine of token.text.split("\n")) {
    for (const wrapped of wrapText(codeLine.length === 0 ? " " : codeLine, Math.max(8, wrapWidth - 4))) {
      out.push(`${dim("  | ", noColor)}${dim(wrapped, noColor)}`);
    }
  }
  out.push(dim("  +", noColor));
  return out;
}

function normalizeFenceLanguage(lang: string | undefined): string | undefined {
  const normalized = lang?.trim();
  return normalized ? normalized : undefined;
}

function isMarkdownFenceLanguage(lang: string | undefined): boolean {
  const normalized = lang?.toLowerCase();
  return normalized === "markdown" || normalized === "md";
}

function hasMarkdownStructure(text: string): boolean {
  return /(^|\n)\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+|\|.+\|\s*$|```)/u.test(text);
}

function renderPlainTableToken(table: Tokens.Table, noColor: boolean, wrapWidth: number): string[] {
  const rows = [
    table.header.map((cell) => plainInlineText(cell.text, noColor, cell.tokens)),
    ...table.rows.map((row) => row.map((cell) => plainInlineText(cell.text, noColor, cell.tokens))),
  ];
  const aligns = table.align.map((align) => align || "left") as MarkdownTableAlign[];
  return renderMarkdownTableLines({ rows, aligns }, noColor, wrapWidth);
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start += 1;
  while (end > start && lines[end - 1] === "") end -= 1;
  return lines.slice(start, end);
}

type MarkdownTableAlign = "left" | "center" | "right";

type MarkdownTable = {
  rows: string[][];
  aligns: MarkdownTableAlign[];
};

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
