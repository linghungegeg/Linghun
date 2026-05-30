import type { Language } from "@linghun/shared";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { ShellController } from "../types.js";

/**
 * BtwPanel — D.14D model-backed side question
 *
 * /btw 是 model-backed 临时插问（参考 CCB sideQuestion.ts 行为）：隔离单轮、
 * 无工具调用，**不污染** main conversation / Todo / Plan / checkpoint / job /
 * permission / evidence / completion gate。逻辑在 btw-runtime.ts，index.ts 只接线。
 *
 * UI 形态：
 * - 标题：/btw <question>（warning 黄 + bold） + dim 副标 "临时插问 · 不影响主任务"
 * - 状态：loading（正在询问）/ answered（模型答案，逐行）/ error（可见错误）
 * - 关闭：Esc / Enter / Space（统一 onDone）
 * - 与 Composer 互斥（Composer.useInput 在 btwPanel 渲染时 isActive=false）
 */

const HINT_TEXT = {
  "zh-CN": {
    title: "/btw",
    subtitle: "临时插问 · 不影响主任务",
    nav: "Esc / Enter / Space 关闭",
    loading: "正在询问模型…",
  },
  "en-US": {
    title: "/btw",
    subtitle: "Side question · main task unaffected",
    nav: "Esc / Enter / Space dismiss",
    loading: "Asking the model…",
  },
} as const;

export function BtwPanel({
  panel,
  controller,
  width,
  noColor,
  language,
}: {
  panel: {
    question: string;
    phase: "loading" | "answered" | "error";
    answer?: string;
    error?: string;
  };
  controller: ShellController;
  width: number;
  noColor: boolean;
  language: Language;
}): React.ReactNode {
  const theme = createShellTheme(noColor);
  const hint = HINT_TEXT[language] ?? HINT_TEXT["zh-CN"];

  useInput((input, key) => {
    if (key.escape || key.return || input === " ") {
      void controller.onInput({ type: "btw-close" });
    }
  });

  const cardWidth = Math.min(width, 84);
  const innerWidth = Math.max(20, cardWidth - 4);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.warning ?? theme.border}
      paddingX={1}
      marginTop={1}
      width={cardWidth}
    >
      <Text color={theme.warning ?? theme.accent} bold>
        {fitText(`${hint.title} ${panel.question}`, innerWidth)}
      </Text>
      <Text color={theme.dim ?? theme.muted} dimColor>
        {fitText(hint.subtitle, innerWidth)}
      </Text>
      <Text color={theme.dim ?? theme.muted} dimColor>
        {fitText(hint.nav, innerWidth)}
      </Text>
      {panel.phase === "loading" ? (
        <Text color={theme.status.running ?? theme.accent}>
          {fitText(hint.loading, innerWidth)}
        </Text>
      ) : null}
      {panel.phase === "answered" && panel.answer
        ? panel.answer.split("\n").map((line, idx) => (
            <Text key={`${idx}-${line.slice(0, 8)}`}>{fitText(line, innerWidth)}</Text>
          ))
        : null}
      {panel.phase === "error" ? (
        <Text color={theme.error ?? theme.status.fail}>
          {fitText(panel.error ?? "error", innerWidth)}
        </Text>
      ) : null}
    </Box>
  );
}
