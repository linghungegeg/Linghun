import { Box, Text } from "ink";
import { createContext, useContext } from "react";
import type React from "react";
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
  return (
    <MessageResponseContext.Provider value={true}>{children}</MessageResponseContext.Provider>
  );
}

export type MessageMarkdownProps = {
  text: string;
  theme: ShellTheme;
  /** 整棵子树 dim（thinking 块、从属响应正文等场景）。 */
  dim?: boolean;
  /** 错误正文走 error 色而不是默认色。 */
  tone?: "default" | "error" | "diagnostic";
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
}: {
  value: string;
  theme: ShellTheme;
  dim: boolean;
  tone: MessageMarkdownProps["tone"];
}): React.ReactNode {
  const tokens = tokenizeInline(value);
  const baseColor = dim
    ? theme.dim
    : tone === "error"
      ? theme.error
      : tone === "diagnostic"
        ? theme.diagnostic
        : theme.assistantText;
  const codeColor = theme.diagnostic ?? theme.accent;
  return (
    <Text color={baseColor} dimColor={dim}>
      {tokens.map((token, idx) => {
        if (token.kind === "code") {
          return (
            <Text key={`tok-${idx}`} color={codeColor} dimColor={dim}>
              {token.value}
            </Text>
          );
        }
        if (token.kind === "bold") {
          return (
            <Text key={`tok-${idx}`} bold color={baseColor} dimColor={dim}>
              {token.value}
            </Text>
          );
        }
        return <Text key={`tok-${idx}`}>{token.value}</Text>;
      })}
    </Text>
  );
}

export function MessageMarkdown({
  text,
  theme,
  dim = false,
  tone = "default",
}: MessageMarkdownProps): React.ReactNode {
  if (!text || text.length === 0) return null;
  const lines = text.replace(/\r/g, "").split("\n");
  const rendered: React.ReactNode[] = [];
  let inCode = false;
  let codeBuffer: string[] = [];
  let blockIndex = 0;
  const codeColor = theme.diagnostic ?? theme.accent;

  const flushCode = (): void => {
    if (codeBuffer.length === 0) return;
    rendered.push(
      <Box key={`code-${blockIndex++}`} flexDirection="column" marginLeft={2}>
        {codeBuffer.map((line, idx) => (
          <Text key={`code-line-${idx}`} color={codeColor} dimColor={dim}>
            {line.length === 0 ? " " : line}
          </Text>
        ))}
      </Box>,
    );
    codeBuffer = [];
  };

  for (const raw of lines) {
    const cls = classifyLine(raw);
    if (cls.kind === "code-fence") {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(raw);
      continue;
    }
    if (cls.kind === "blank") {
      rendered.push(<Box key={`blank-${blockIndex++}`} height={1} />);
      continue;
    }
    if (cls.kind === "list") {
      rendered.push(
        <Box key={`list-${blockIndex++}`} flexDirection="row">
          <Text color={dim ? theme.dim : theme.muted} dimColor={dim}>
            {cls.bullet}
            {" "}
          </Text>
          <InlineRow value={cls.rest} theme={theme} dim={dim} tone={tone} />
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
      />,
    );
  }
  if (inCode) flushCode();

  return <Box flexDirection="column">{rendered}</Box>;
}
