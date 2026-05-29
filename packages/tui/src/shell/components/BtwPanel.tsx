import type { Language } from "@linghun/shared";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { ShellController } from "../types.js";

/**
 * BtwPanel — D.13Q-UX Closure
 *
 * 当前实现是 **local note panel**：把 /btw 输入的临时小问题以 inline side
 * panel 形式记录在 session store，**不调模型 / provider**，不污染 main
 * conversation / Todo / Plan / checkpoint / job / permission。
 *
 * UI 形态：
 * - 标题：/btw <question>（warning 黄 + bold） + dim 副标 "本地备忘 · 不调模型"
 * - 内容：local note 文本（plain 文本，不再走 Markdown 假装答案）
 * - 关闭：Esc / Enter / Space / Ctrl+C / Ctrl+D（统一 onDone）
 * - 与 Composer 互斥（Composer.useInput 在 btwPanel 渲染时 isActive=false）
 *
 * 真异步 side-question runtime（spinner → 模型答案）需要 provider 调用 +
 * 异步 controller，跨阶段动作较大；本阶段不做。如需模型回答，直接发普通
 * 输入。
 */

const HINT_TEXT = {
  "zh-CN": {
    title: "/btw",
    subtitle: "本地备忘 · 不调模型",
    nav: "Esc / Enter / Space 关闭",
  },
  "en-US": {
    title: "/btw",
    subtitle: "Local note · model not called",
    nav: "Esc / Enter / Space dismiss",
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
