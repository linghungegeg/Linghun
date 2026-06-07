import { Box, Text } from "ink";
import { createContext, useContext } from "react";
import type React from "react";
import { memo, useRef } from "react";
import { charWidth, wrapText } from "../text-utils.js";
import type { ShellTheme } from "../theme.js";
import type { ProductBlockSelectionRange } from "../types.js";

/**
 * D.13Q-UX — MessageMarkdown
 *
 * CCB Markdown.tsx 范式：assistant 正文 / 多行文本走轻量 Markdown 渲染，
 * 保留段落、空行、列表（- / *）、粗体（**...**）、行内代码（`...`）、
 * 代码块（``` ... ```）。不引入 marked / cli-highlight 依赖，避免本波
 * 给 TUI 增加重运行时；只覆盖最常见场景。
 *
 * 设计原则（参考 CCB Markdown.tsx + StreamingMarkdown 行为，仅借鉴范式）：
 * - 默认色（不强加 cyan/info），dim 通过 prop 透传整棵子树。
 * - **不打平多行**：保留 \n、空行段落、列表项；不做 fitLine
 *   replace(/\s+/gu," ").trim() 这种破坏正文的处理。
 * - 不解析 HTML / 链接，避免给 TUI 引入解析风险；行内 `code` / **bold**
 *   作为字符串级 token 处理，足够覆盖普通中文 / 英文报告。
 * - 子组件渲染靠 Ink Text/Box，无 React 状态。
 */

/**
 * MessageResponseContext —— CCB MessageResponse.tsx 同款"防嵌套"机制：
 * 一旦消息已经在 ⎿ 前缀的从属响应里，子节点不应再画一层 ⎿。
 * 没有 Provider 时默认为 false（顶层）。
 */
const MessageResponseContext = createContext<boolean>(false);

export function useInMessageResponse(): boolean {
  return useContext(MessageResponseContext);
}

export function MessageResponseProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return <MessageResponseContext.Provider value={true}>{children}</MessageResponseContext.Provider>;
}

export type MessageMarkdownProps = {
  text: string;
  theme: ShellTheme;
  /** 整棵子树 dim（thinking 块、从属响应正文等场景）。 */
  dim?: boolean;
  /** 错误正文走 error 色而不是默认色。 */
  tone?: "default" | "error" | "diagnostic";
  wrapWidth?: number;
  selectionLineIndexes?: number[];
  selectionLineRanges?: ProductBlockSelectionRange[];
};

type MdLine =
  | { kind: "blank" }
  | { kind: "code-fence"; lang?: string }
  | { kind: "code-line"; raw: string }
  | { kind: "list"; bullet: string; rest: string }
  | { kind: "para"; raw: string };

function classifyLine(line: string): MdLine {
  if (line.trim().length === 0) return { kind: "blank" };
  const fenceMatch = line.match(/^\s*```\s*([A-Za-z0-9_+-]*)\s*$/u);
  if (fenceMatch) return { kind: "code-fence", lang: fenceMatch[1] || undefined };
  const listMatch = line.match(/^\s*([-*])\s+(.*)$/u);
  if (listMatch) {
    const bullet = listMatch[1] ?? "-";
    const rest = listMatch[2] ?? "";
    return { kind: "list", bullet, rest };
  }
  return { kind: "para", raw: line };
}

type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "bold"; value: string };

const INLINE_TOKEN_RE = /(`[^`\n]+`|\*\*[^*\n][^\n]*?\*\*)/u;

function tokenizeInline(value: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let remaining = value;
  while (remaining.length > 0) {
    const match = remaining.match(INLINE_TOKEN_RE);
    if (!match || match.index === undefined) {
      tokens.push({ kind: "text", value: remaining });
      break;
    }
    if (match.index > 0) {
      tokens.push({ kind: "text", value: remaining.slice(0, match.index) });
    }
    const matched = match[0];
    if (matched.startsWith("`")) {
      tokens.push({ kind: "code", value: matched.slice(1, -1) });
    } else {
      tokens.push({ kind: "bold", value: matched.slice(2, -2) });
    }
    remaining = remaining.slice(match.index + matched.length);
  }
  return tokens;
}

function InlineRow({
  value,
  theme,
  dim,
  tone,
  wrapWidth,
  selected,
}: {
  value: string;
  theme: ShellTheme;
  dim: boolean;
  tone: MessageMarkdownProps["tone"];
  wrapWidth?: number;
  selected?: boolean;
}): React.ReactNode {
  const rows = wrapWidth ? wrapText(value, wrapWidth) : [value];
  const baseColor = dim
    ? theme.dim
    : tone === "error"
      ? theme.error
      : tone === "diagnostic"
        ? theme.diagnostic
        : theme.assistantText;
  const codeColor = theme.diagnostic ?? theme.accent;
  return (
    <Box flexDirection="column">
      {rows.map((row, rowIndex) => {
        const tokens = tokenizeInline(row);
        return (
          <Text
            key={`${rowIndex}-${row}`}
            color={selected ? "white" : baseColor}
            backgroundColor={selected && theme.mode !== "no-color" ? "blue" : undefined}
            dimColor={selected ? false : dim}
          >
            {tokens.map((token, tokenIndex) => {
              const key = `${rowIndex}-${tokenIndex}-${token.kind}-${token.value}`;
              if (token.kind === "code") {
                return (
                  <Text
                    key={key}
                    color={selected ? "white" : codeColor}
                    dimColor={selected ? false : dim}
                  >
                    {token.value}
                  </Text>
                );
              }
              if (token.kind === "bold") {
                return (
                  <Text
                    key={key}
                    bold
                    color={selected ? "white" : baseColor}
                    dimColor={selected ? false : dim}
                  >
                    {token.value}
                  </Text>
                );
              }
              return <Text key={key}>{token.value}</Text>;
            })}
          </Text>
        );
      })}
    </Box>
  );
}

function InlineText({
  value,
  theme,
  dim,
  tone,
  selected,
}: {
  value: string;
  theme: ShellTheme;
  dim: boolean;
  tone: MessageMarkdownProps["tone"];
  selected?: boolean;
}): React.ReactNode {
  const baseColor = dim
    ? theme.dim
    : tone === "error"
      ? theme.error
      : tone === "diagnostic"
        ? theme.diagnostic
        : theme.assistantText;
  const codeColor = theme.diagnostic ?? theme.accent;
  const tokens = tokenizeInline(value);
  return (
    <Text
      color={selected ? "white" : baseColor}
      backgroundColor={selected && theme.mode !== "no-color" ? "blue" : undefined}
      dimColor={selected ? false : dim}
    >
      {tokens.map((token, tokenIndex) => {
        const key = `${tokenIndex}-${token.kind}-${token.value}`;
        if (token.kind === "code") {
          return (
            <Text key={key} color={selected ? "white" : codeColor} dimColor={selected ? false : dim}>
              {token.value}
            </Text>
          );
        }
        if (token.kind === "bold") {
          return (
            <Text
              key={key}
              bold
              color={selected ? "white" : baseColor}
              dimColor={selected ? false : dim}
            >
              {token.value}
            </Text>
          );
        }
        return <Text key={key}>{token.value}</Text>;
      })}
    </Text>
  );
}

function InlineCellRangeRow({
  value,
  ranges,
  theme,
  dim,
  tone,
}: {
  value: string;
  ranges: ProductBlockSelectionRange[];
  theme: ShellTheme;
  dim: boolean;
  tone: MessageMarkdownProps["tone"];
}): React.ReactNode {
  const segments = splitLineBySelectionRanges(value, ranges);
  return (
    <Text>
      {segments.map((segment, index) => (
        <InlineText
          key={`${index}-${segment.selected ? "selected" : "plain"}-${segment.text}`}
          value={segment.text}
          theme={theme}
          dim={dim}
          tone={tone}
          selected={segment.selected}
        />
      ))}
    </Text>
  );
}

function splitLineBySelectionRanges(
  value: string,
  ranges: ProductBlockSelectionRange[],
): Array<{ text: string; selected: boolean }> {
  const chars = Array.from(value);
  const totalWidth = chars.reduce((width, char) => width + Math.max(1, charWidth(char)), 0);
  const normalized = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(totalWidth, range.startColumn)),
      end: Math.max(0, Math.min(totalWidth, range.endColumn)),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (normalized.length === 0) return [{ text: value, selected: false }];
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of normalized) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  const segments: Array<{ text: string; selected: boolean }> = [];
  let current = "";
  let currentSelected: boolean | undefined;
  let column = 0;
  const pushCurrent = () => {
    if (currentSelected === undefined || current.length === 0) return;
    segments.push({ text: current, selected: currentSelected });
    current = "";
  };
  for (const char of chars) {
    const width = Math.max(1, charWidth(char));
    const charStart = column;
    const charEnd = column + width;
    const selected = merged.some((range) => range.start < charEnd && range.end > charStart);
    if (currentSelected !== selected) {
      pushCurrent();
      currentSelected = selected;
    }
    current += char;
    column = charEnd;
  }
  pushCurrent();
  return segments;
}

function codePrefix(theme: ShellTheme, dim: boolean): React.ReactNode {
  return (
    <Text color={theme.dim ?? theme.muted} dimColor={dim}>
      {"  | "}
    </Text>
  );
}

function CodeLine({
  line,
  lang,
  theme,
  dim,
  selected,
  ranges,
}: {
  line: string;
  lang?: string;
  theme: ShellTheme;
  dim: boolean;
  selected?: boolean;
  ranges?: ProductBlockSelectionRange[];
}): React.ReactNode {
  const isDiff = lang === "diff" || lang === "patch";
  const color =
    isDiff && line.startsWith("+") && !line.startsWith("+++")
      ? (theme.success ?? theme.status.pass)
      : isDiff && line.startsWith("-") && !line.startsWith("---")
        ? (theme.error ?? theme.status.fail)
        : (theme.diagnostic ?? theme.accent);
  const dimLine = dim || (isDiff && !line.startsWith("+") && !line.startsWith("-"));
  if (ranges && ranges.length > 0) {
    const segments = splitLineBySelectionRanges(line.length === 0 ? " " : line, ranges);
    return (
      <Text>
        {segments.map((segment, index) => (
          <Text
            key={`${index}-${segment.selected ? "selected" : "plain"}-${segment.text}`}
            color={segment.selected ? "white" : color}
            backgroundColor={segment.selected && theme.mode !== "no-color" ? "blue" : undefined}
            dimColor={segment.selected ? false : dimLine}
          >
            {segment.text}
          </Text>
        ))}
      </Text>
    );
  }
  return (
    <Text
      color={selected ? "white" : color}
      backgroundColor={selected && theme.mode !== "no-color" ? "blue" : undefined}
      dimColor={selected ? false : dimLine}
    >
      {line.length === 0 ? " " : line}
    </Text>
  );
}

export function MessageMarkdown({
  text,
  theme,
  dim = false,
  tone = "default",
  wrapWidth,
  selectionLineIndexes,
  selectionLineRanges,
}: MessageMarkdownProps): React.ReactNode {
  if (!text || text.length === 0) return null;
  const lines = text.replace(/\r/g, "").split("\n");
  const selectedLines = new Set(selectionLineIndexes ?? []);
  const selectedRangesByLine = new Map<number, ProductBlockSelectionRange[]>();
  for (const range of selectionLineRanges ?? []) {
    const existing = selectedRangesByLine.get(range.lineIndex) ?? [];
    existing.push(range);
    selectedRangesByLine.set(range.lineIndex, existing);
  }
  const rendered: React.ReactNode[] = [];
  let inCode = false;
  let codeLang: string | undefined;
  let codeBuffer: { line: string; lineIndex: number }[] = [];
  let blockIndex = 0;

  const flushCode = (): void => {
    if (codeBuffer.length === 0) return;
    rendered.push(
      <Box key={`code-${blockIndex++}`} flexDirection="column" marginLeft={1}>
        <Text color={theme.dim ?? theme.muted} dimColor={dim}>
          {`  \u250C${codeLang ? ` ${codeLang} ` : ""}`}
        </Text>
        {codeBuffer.map(({ line, lineIndex }) => (
          <Box key={`code-line-${lineIndex}-${line}`} flexDirection="row">
            {codePrefix(theme, dim)}
            <CodeLine
              line={line}
              lang={codeLang}
              theme={theme}
              dim={dim}
              selected={selectedLines.has(lineIndex)}
              ranges={selectedRangesByLine.get(lineIndex)}
            />
          </Box>
        ))}
        <Text color={theme.dim ?? theme.muted} dimColor={dim}>
          {"  \u2514"}
        </Text>
      </Box>,
    );
    codeBuffer = [];
    codeLang = undefined;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex] ?? "";
    const cls = classifyLine(raw);
    if (cls.kind === "code-fence") {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
        codeLang = cls.lang;
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push({ line: raw, lineIndex });
      continue;
    }
    if (cls.kind === "blank") {
      rendered.push(<Box key={`blank-${blockIndex++}`} height={1} />);
      continue;
    }
    if (cls.kind === "list") {
      const ranges = selectedRangesByLine.get(lineIndex) ?? [];
      rendered.push(
        <Box key={`list-${blockIndex++}`} flexDirection="row">
          <Text
            color={selectedLines.has(lineIndex) ? "white" : dim ? theme.dim : theme.muted}
            backgroundColor={
              selectedLines.has(lineIndex) && theme.mode !== "no-color" ? "blue" : undefined
            }
            dimColor={selectedLines.has(lineIndex) ? false : dim}
          >
            {cls.bullet}{" "}
          </Text>
          {ranges.length > 0 ? (
            <InlineCellRangeRow
              value={cls.rest}
              ranges={ranges.map((range) => ({
                ...range,
                startColumn: Math.max(0, range.startColumn - 2),
                endColumn: Math.max(0, range.endColumn - 2),
              }))}
              theme={theme}
              dim={dim}
              tone={tone}
            />
          ) : (
            <InlineRow
              value={cls.rest}
              theme={theme}
              dim={dim}
              tone={tone}
              wrapWidth={wrapWidth ? Math.max(8, wrapWidth - 2) : undefined}
              selected={selectedLines.has(lineIndex)}
            />
          )}
        </Box>,
      );
      continue;
    }
    const ranges = selectedRangesByLine.get(lineIndex) ?? [];
    if (ranges.length > 0) {
      rendered.push(
        <InlineCellRangeRow
          key={`para-${blockIndex++}`}
          value={cls.raw}
          ranges={ranges}
          theme={theme}
          dim={dim}
          tone={tone}
        />,
      );
      continue;
    }
    rendered.push(
      <InlineRow
        key={`para-${blockIndex++}`}
        value={cls.raw}
        theme={theme}
        dim={dim}
        tone={tone}
        wrapWidth={wrapWidth}
        selected={selectedLines.has(lineIndex)}
      />,
    );
  }
  if (inCode) flushCode();

  return <Box flexDirection="column">{rendered}</Box>;
}

const MemoMessageMarkdown = memo(MessageMarkdown);

export type StreamingMarkdownState = {
  stablePrefix: string;
};

export function splitStreamingMarkdownForRender(
  text: string,
  state: StreamingMarkdownState,
): { stablePrefix: string; unstableSuffix: string; parsedSuffixInput: string } {
  const normalized = text.replace(/\r/g, "");
  if (!normalized.startsWith(state.stablePrefix)) {
    state.stablePrefix = "";
  }
  const boundary = state.stablePrefix.length;
  const suffixInput = normalized.slice(boundary);
  const advance = findStablePrefixAdvance(suffixInput);
  if (advance > 0) {
    state.stablePrefix = normalized.slice(0, boundary + advance);
  }
  return {
    stablePrefix: state.stablePrefix,
    unstableSuffix: normalized.slice(state.stablePrefix.length),
    parsedSuffixInput: suffixInput,
  };
}

function findStablePrefixAdvance(text: string): number {
  let offset = 0;
  let boundary = 0;
  let inCode = false;
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/gu)) {
    const segment = match[0];
    if (!segment) break;
    if (!segment.endsWith("\n")) break;
    const line = segment.slice(0, -1);
    const fence = /^\s*```\s*[A-Za-z0-9_+-]*\s*$/u.test(line);
    if (fence) {
      inCode = !inCode;
      offset += segment.length;
      if (!inCode) boundary = offset;
      continue;
    }
    offset += segment.length;
    if (!inCode && line.trim().length === 0) boundary = offset;
  }
  if (!inCode && text.endsWith("\n") && hasBalancedInlineMarkdown(text)) return text.length;
  return boundary;
}

function hasBalancedInlineMarkdown(text: string): boolean {
  let inInlineCode = false;
  let boldOpen = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "`") {
      inInlineCode = !inInlineCode;
      continue;
    }
    if (!inInlineCode && char === "*" && text[index + 1] === "*") {
      boldOpen = !boldOpen;
      index += 1;
    }
  }
  return !inInlineCode && !boldOpen;
}

export function StreamingMarkdown({
  text,
  theme,
  dim = false,
  tone = "default",
  wrapWidth,
}: MessageMarkdownProps): React.ReactNode {
  const stateRef = useRef<StreamingMarkdownState>({ stablePrefix: "" });
  const { stablePrefix, unstableSuffix } = splitStreamingMarkdownForRender(text, stateRef.current);
  return (
    <Box flexDirection="column">
      {stablePrefix ? (
        <MemoMessageMarkdown
          text={stablePrefix}
          theme={theme}
          dim={dim}
          tone={tone}
          wrapWidth={wrapWidth}
        />
      ) : null}
      {unstableSuffix ? (
        <MessageMarkdown
          text={unstableSuffix}
          theme={theme}
          dim={dim}
          tone={tone}
          wrapWidth={wrapWidth}
        />
      ) : null}
    </Box>
  );
}
