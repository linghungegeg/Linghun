import type { Language } from "@linghun/shared";
import { Box, Text } from "ink";
import type React from "react";
import { fitText } from "../text-utils.js";
import type { ShellTheme } from "../theme.js";
import type { TaskFooterView } from "../types.js";

/**
 * D.13Q-UX — StatusFooter
 *
 * CCB PromptInputFooter / StatusLine / BuiltinStatusLine 范式：
 * - 三栏分区（左 mode pill + cyclePermHint，右 model · cache · index ·
 *   reasoning，hint 可选放最右）。
 * - 右对齐元数据用 flexShrink=0；左侧吃剩余宽度并 truncate。
 * - 窄屏（width < 60）走列向布局，避免单行挤压。
 * - cacheTone === "warning" 时 cache 段染 warning 色；模型 dim 时 model 段染 dim。
 *
 * 与 ShellApp 旧 TaskFooter 兼容：保留单行紧凑形态；语义颜色由 theme 决定。
 */

export type StatusFooterProps = {
  footer: TaskFooterView;
  theme: ShellTheme;
  width: number;
  language: Language;
  /** model 段是否染 dim（setup-needed / 占位时 true）。 */
  modelDim?: boolean;
  /** cache 段语义色调（命中率低时染 warning）。 */
  cacheTone?: "default" | "warning" | "dim";
};

export function StatusFooter({
  footer,
  theme,
  width,
  language,
  modelDim = false,
  cacheTone = "default",
}: StatusFooterProps): React.ReactNode {
  void language;
  // 右栏（model · cache · index · reasoning · hint）按 flexShrink=0 右对齐。
  const rightSegments: { key: string; text: string; tone?: "warning" | "dim" | "default" }[] = [
    ...(footer.task ? [{ key: "task", text: footer.task, tone: "default" as const }] : []),
    ...(footer.elapsed ? [{ key: "elapsed", text: footer.elapsed, tone: "dim" as const }] : []),
    { key: "model", text: footer.model, tone: modelDim ? "dim" : "default" },
    {
      key: "cache",
      text: footer.cache,
      tone: cacheTone === "warning" ? "warning" : cacheTone === "dim" ? "dim" : "default",
    },
    { key: "index", text: footer.index, tone: "default" },
  ];
  if (footer.reasoning) rightSegments.push({ key: "reasoning", text: footer.reasoning });
  if (footer.hint) rightSegments.push({ key: "hint", text: footer.hint, tone: "dim" });

  // 窄屏列向布局：左行（mode + cyclePermHint）一行，右栏分两行展示，避免挤压。
  const narrow = width < 60;
  if (narrow) {
    return (
      <Box flexDirection="column" width={width} paddingX={2} paddingTop={1}>
        <Text>
          <Text color={theme.muted}>{footer.permissionMode}</Text>
          <Text color={theme.status.fail}>{footer.cyclePermHint}</Text>
        </Text>
        <Text>
          {rightSegments.map((seg, idx) => (
            <Text key={seg.key} color={pickColor(theme, seg.tone)} dimColor={seg.tone === "dim"}>
              {idx > 0 ? " · " : ""}
              {seg.text}
            </Text>
          ))}
        </Text>
      </Box>
    );
  }

  const reservedRight = rightSegments.reduce(
    (acc, seg, idx) => acc + (seg.text?.length ?? 0) + (idx > 0 ? 3 : 0),
    0,
  );
  const leftBudget = Math.max(20, width - 4 - reservedRight - 2);
  const left = `${footer.permissionMode}${footer.cyclePermHint}`;
  const fittedLeft = left.length > leftBudget ? fitText(left, leftBudget) : left;

  return (
    <Box width={width} paddingX={2} paddingTop={1}>
      <Box flexGrow={1} flexShrink={1}>
        <Text>
          <Text color={theme.muted}>{footer.permissionMode}</Text>
          <Text color={theme.status.fail}>{fittedLeft.slice(footer.permissionMode.length)}</Text>
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text>
          {rightSegments.map((seg, idx) => (
            <Text key={seg.key} color={pickColor(theme, seg.tone)} dimColor={seg.tone === "dim"}>
              {idx > 0 ? " · " : ""}
              {seg.text}
            </Text>
          ))}
        </Text>
      </Box>
    </Box>
  );
}

function pickColor(
  theme: ShellTheme,
  tone: "warning" | "dim" | "default" | undefined,
): string | undefined {
  if (tone === "warning") return theme.warning ?? theme.status.fail;
  if (tone === "dim") return theme.dim ?? theme.muted;
  return theme.muted;
}
