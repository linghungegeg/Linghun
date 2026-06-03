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
 * - 标题：/btw <question>
 * - 状态：loading（正在询问）/ answered（模型答案，逐行）/ error（可见错误）
 * - 关闭：Esc / Enter / Space（底部只显示 Esc 关闭）
 * - 与 Composer 互斥（Composer.useInput 在 btwPanel 渲染时 isActive=false）
 */

const HINT_TEXT = {
  "zh-CN": {
    title: "/btw",
    nav: "Esc 关闭",
    loading: "正在询问模型…",
  },
  "en-US": {
    title: "/btw",
    nav: "Esc dismiss",
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
  const innerWidth = Math.max(20, cardWidth - 2);

  return (
    <Box flexDirection="column" marginTop={1} width={cardWidth}>
      <Text>
        <Text color={theme.warning ?? theme.accent}>{hint.title}</Text>{" "}
        <Text>{fitText(panel.question, Math.max(8, innerWidth - hint.title.length - 1))}</Text>
      </Text>
      {panel.phase === "loading" ? (
        <Text color={theme.status.running ?? theme.accent}>
          {fitText(hint.loading, innerWidth)}
        </Text>
      ) : null}
      {panel.phase === "answered" && panel.answer
        ? panel.answer
            .split("\n")
            .map((line, idx) => (
              <Text key={`${idx}-${line.slice(0, 8)}`}>{fitText(line, innerWidth)}</Text>
            ))
        : null}
      {panel.phase === "error" ? (
        <Text color={theme.error ?? theme.status.fail}>
          {fitText(panel.error ?? "error", innerWidth)}
        </Text>
      ) : null}
      <Text color={theme.dim ?? theme.muted} dimColor>
        {fitText(hint.nav, innerWidth)}
      </Text>
    </Box>
  );
}
