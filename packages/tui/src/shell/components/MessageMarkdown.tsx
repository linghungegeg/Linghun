import { Box, Text } from "ink";
import { createContext, useContext } from "react";
import type React from "react";
import { wrapText } from "../text-utils.js";
import type { ShellTheme } from "../theme.js";

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
}: {
  line: string;
  lang?: string;
  theme: ShellTheme;
  dim: boolean;
  selected?: boolean;
}): React.ReactNode {
  const isDiff = lang === "diff" || lang === "patch";
  const color =
    isDiff && line.startsWith("+") && !line.startsWith("+++")
      ? (theme.success ?? theme.status.pass)
      : isDiff && line.startsWith("-") && !line.startsWith("---")
        ? (theme.error ?? theme.status.fail)
        : (theme.diagnostic ?? theme.accent);
  const dimLine = dim || (isDiff && !line.startsWith("+") && !line.startsWith("-"));
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
}: MessageMarkdownProps): React.ReactNode {
  if (!text || text.length === 0) return null;
  const lines = text.replace(/\r/g, "").split("\n");
  const selectedLines = new Set(selectionLineIndexes ?? []);
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
          <InlineRow
            value={cls.rest}
            theme={theme}
            dim={dim}
            tone={tone}
            wrapWidth={wrapWidth ? Math.max(8, wrapWidth - 2) : undefined}
            selected={selectedLines.has(lineIndex)}
          />
        </Box>,
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
