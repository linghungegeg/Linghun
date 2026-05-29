import { Box, Text } from "ink";
import type React from "react";
import { fitText } from "../text-utils.js";
import { type ShellTheme, getStatusMarker } from "../theme.js";
import type { MessageBlockKind, ProductBlockViewModel } from "../types.js";
import { CtrlOToExpand } from "./CtrlOToExpand.js";
import { MessageMarkdown } from "./MessageMarkdown.js";

/**
 * D13E-P3 cleanup #3 — title 噪音过滤：
 * "unknown" / "Unknown" / 空白都视作没有 title，避免 ProductBlock 把
 * fallback 占位词当作产品级标题渲染（"● unknown" 是观察到的真实泄漏）。
 * 调用方仍可传任何字符串；这里只是渲染层的最后一道防线。
 */
function isMeaningfulTitle(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase() === "unknown") return false;
  return true;
}

/**
 * D.13Q-UX — 消息语义 block 集合：assistant_text / tool_result_* / diagnostic /
 * local_command_output / assistant_thinking。这些 block 走 MessageMarkdown
 * 渲染，保留多行/段落/列表/代码块，不卡片化、不强加 cyan/info dot。
 */
function isMessageKind(kind: MessageBlockKind | undefined): boolean {
  if (!kind) return false;
  return (
    kind === "assistant_text" ||
    kind === "assistant_thinking" ||
    kind === "local_command_output" ||
    kind === "tool_result_success" ||
    kind === "tool_result_error" ||
    kind === "tool_result_cancelled" ||
    kind === "tool_result_rejected" ||
    kind === "diagnostic"
  );
}

export function ProductBlock({
  block,
  theme,
  width,
}: {
  block: ProductBlockViewModel;
  theme: ShellTheme;
  width: number;
}): React.ReactNode {
  const compact = width < 60;
  // Command transcript row — slash command 提交后作为独立 `❯ /command` 行进入
  // task transcript，与下方 tool/output 块视觉分层。U+276F + accent 颜色，
  // 不带 status marker、不带 detail/nextAction，只显示一行命令。
  // P0-3：command 显式保持 marginBottom=0，紧贴下方 tool/output 块；
  // 其他 kind 之间统一加 marginBottom=1，让长 transcript 可扫读。
  // P2-3：command 行额外加 marginTop=1，与上方块拉开 1 行视觉间隔，
  // 不引入全局序号或时间戳（避免依赖外部状态 / 假数据）。
  if (block.kind === "command") {
    return (
      <Box marginTop={1} marginBottom={0}>
        <Text>
          <Text color={theme.muted}>{"❯ "}</Text>
          <Text color={theme.accent}>{fitText(block.title, Math.max(8, width - 2))}</Text>
        </Text>
      </Box>
    );
  }

  // D.13Q-UX —— 消息语义 block 走 MessageMarkdown 渲染。
  // 不卡片化、不打平、不借 cyan/info dot；保留多行段落 / 列表 / 代码块。
  // tool_result_error 仍走下方 alert 卡分支（带 red border），但正文用
  // MessageMarkdown 渲染。
  if (
    isMessageKind(block.messageKind) &&
    block.messageKind !== "tool_result_error" &&
    block.messageKind !== "assistant_thinking"
  ) {
    const body = (block.fullText ?? block.summary ?? "").trim();
    if (!body) return null;
    const isLocalOutput = block.messageKind === "local_command_output";
    const isDiagnostic = block.messageKind === "diagnostic";
    const isCancelled = block.messageKind === "tool_result_cancelled";
    const isRejected = block.messageKind === "tool_result_rejected";
    const dim = isCancelled || isRejected;
    const tone = isDiagnostic ? "diagnostic" : "default";
    return (
      <Box flexDirection="column" marginBottom={1}>
        {isLocalOutput ? (
          <Box flexDirection="row">
            <Text color={theme.dim ?? theme.muted} dimColor>
              {"  ⎿  "}
            </Text>
            <MessageMarkdown text={body} theme={theme} dim={dim} tone={tone} />
          </Box>
        ) : (
          <MessageMarkdown text={body} theme={theme} dim={dim} tone={tone} />
        )}
        {block.nextAction ? (
          <CtrlOToExpand theme={theme} hint={fitText(block.nextAction, Math.max(8, width - 2))} />
        ) : null}
      </Box>
    );
  }

  // assistant_thinking 走 dim italic。
  if (block.messageKind === "assistant_thinking") {
    const body = (block.fullText ?? block.summary ?? "").trim();
    if (!body) return null;
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.dim ?? theme.muted} italic dimColor>
          {"∴ "}
        </Text>
        <MessageMarkdown text={body} theme={theme} dim />
        {block.nextAction ? (
          <CtrlOToExpand theme={theme} hint={fitText(block.nextAction, Math.max(8, width - 2))} />
        ) : null}
      </Box>
    );
  }

  // P2-1：permission / fail / blocked / error 在非 compact 宽度下都用 bordered card。
  // - permission：原 P0-1 已用 single border。
  // - fail：原 D.13D 已用 single border。
  // - blocked / error：新增，使用 status 配色 (blocked=yellow, error→fail=red)
  //   作为 borderColor，让长 transcript 中的阻塞 / 错误块可扫读。
  // 其余状态（info / running / pass / partial）保持无边框，避免视觉过载。
  const isAlert =
    block.kind === "permission" ||
    block.kind === "error" ||
    block.status === "fail" ||
    block.status === "blocked" ||
    block.messageKind === "tool_result_error";
  const emphasized = isAlert && !compact;
  // permission 卡保持中性 border 色（与 P0-1 锚定问题行配色一致）；
  // error / blocked / fail 用 status 色边框：red / yellow / red。
  // D.13Q-UX：permission 卡用独立 permission 主题色，让 PermissionPanel 与
  // 普通 alert 一眼可分。
  const borderColor = emphasized
    ? block.kind === "permission"
      ? theme.permission ?? theme.border
      : block.messageKind === "tool_result_error"
        ? theme.error ?? theme.status.fail
        : (theme.status[block.status] ?? theme.border)
    : undefined;
  // P2-2：detail / nextAction 走 fitText 防御截断。
  // 边框态 paddingX=1，左右各 1 列+边框 2 列 = 4 列开销，预留出来防溢出。
  const innerWidth = Math.max(8, width - (emphasized ? 4 : 0));

  // tool_result_error: 标题/状态行保留，正文走 MessageMarkdown 红色，可展开 hint 用 CtrlOToExpand。
  if (block.messageKind === "tool_result_error") {
    const body = (block.fullText ?? block.summary ?? "").trim();
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={borderColor}
        paddingX={1}
        marginBottom={1}
      >
        {isMeaningfulTitle(block.title) ? (
          <Text>
            <Text color={theme.error ?? theme.status.fail}>
              {getStatusMarker("fail", theme.mode === "no-color")}
            </Text>
            {" "}
            <Text color={theme.error ?? theme.status.fail}>{block.title}</Text>
          </Text>
        ) : null}
        {body ? <MessageMarkdown text={body} theme={theme} tone="error" /> : null}
        {block.nextAction ? (
          <CtrlOToExpand theme={theme} hint={fitText(block.nextAction, innerWidth)} />
        ) : null}
      </Box>
    );
  }

  // D13E-P3 cleanup #3：title 为空 / "unknown" 时不渲染 title 行。如果同时
  // 也没有 detail / nextAction，summary 就上提到 marker 行，让块依然有视觉
  // 主体（"● 我不能讨论这个。" 这种安全拒绝回复就是典型场景）。空 summary
  // 直接不渲染整个块，避免出现一个孤零零的 marker 行。
  const titleVisible = isMeaningfulTitle(block.title);
  const summaryTrimmed = (block.summary ?? "").trim();
  if (!titleVisible && !summaryTrimmed && !block.detail && !block.nextAction) {
    return null;
  }
  const summaryAsMarker = !titleVisible && summaryTrimmed.length > 0;
  return (
    <Box
      flexDirection="column"
      borderStyle={emphasized ? "single" : undefined}
      borderColor={borderColor}
      paddingX={emphasized ? 1 : 0}
      marginBottom={1}
    >
      {titleVisible ? (
        <Text>
          <Text color={theme.status[block.status]}>
            {getStatusMarker(block.status, theme.mode === "no-color")}
          </Text>
          {" "}
          {block.title}
        </Text>
      ) : summaryAsMarker ? (
        <Text color={theme.status[block.status]}>
          {getStatusMarker(block.status, theme.mode === "no-color")} {block.summary}
        </Text>
      ) : null}
      {!summaryAsMarker && summaryTrimmed ? <Text>{block.summary}</Text> : null}
      {block.detail ? (
        <Text color={theme.muted}>{fitText(block.detail, innerWidth)}</Text>
      ) : null}
      {block.nextAction ? (
        <CtrlOToExpand theme={theme} hint={fitText(block.nextAction, innerWidth)} />
      ) : null}
    </Box>
  );
}
