import { Box, Text } from "@linghun/ink-runtime";
import type { Language } from "@linghun/shared";
import type React from "react";
import { fitText } from "../text-utils.js";
import type { ShellTheme } from "../theme.js";
import type { TaskFooterView } from "../types.js";

/**
 * D.13Q-UX — StatusFooter (Phase 5: two-line on wide screens, CCB PromptInputFooter layout).
 *
 * Layout by screen width:
 * - ≥80 cols (wide): two rows
 *   Row 1: StatusLine (workspaceStatus + runtimeStatus, dim)
 *   Row 2: permissionMode · cyclePermHint (left) | model · cache · index · git · context (right)
 * - <80 cols (narrow): single line, left mode + right segments (priority: mode > model > index)
 *
 * #6/#7/#8: permission mode semantic color, narrow-screen priority, dim separators,
 * protection/scope text shortened and dimmed.
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
  /** R4 — git branch name to display. */
  gitBranch?: string;
};

export function StatusFooter({
  footer,
  theme,
  width,
  language,
  modelDim = false,
  cacheTone = "default",
  gitBranch,
}: StatusFooterProps): React.ReactNode {
  void language;
  // R1-8: 默认保留 权限模式 + 模型 + 缓存 + 索引 + 推理；费用估算避免误导，移入详情入口。
  const rightSegments: { key: string; text: string; tone?: "warning" | "dim" | "default"; priority: number }[] = [
    { key: "model", text: footer.model, tone: modelDim ? "dim" : "default", priority: 2 },
    {
      key: "cache",
      text: footer.cache,
      tone: cacheTone === "warning" ? "warning" : cacheTone === "dim" ? "dim" : "default",
      priority: 4,
    },
    { key: "index", text: footer.index, tone: "default", priority: 3 },
  ];
  if (gitBranch) rightSegments.push({ key: "branch", text: `⎇ ${gitBranch}`, tone: "dim", priority: 5 });
  if (footer.contextUsage)
    rightSegments.push({ key: "context", text: footer.contextUsage, tone: "dim", priority: 6 });
  if (footer.reasoning) rightSegments.push({ key: "reasoning", text: footer.reasoning, priority: 7 });

  // Narrow (<80 cols): filter to high-priority segments only (mode > model > index).
  const narrow = width < 80;
  const remoteSegment = footer.isRemoteMode
    ? [{ key: "remote", text: "● remote", tone: "dim" as const, priority: 1 }]
    : [];

  // #8 narrow-screen priority: show only priority ≤ 3 (mode, model, index)
  const visibleRight = narrow
    ? rightSegments.filter((seg) => seg.priority <= 3)
    : rightSegments;

  if (narrow) {
    return (
      <Box flexDirection="column" width={width} paddingX={2} paddingTop={1}>
        <Text>
          <Text color={footer.permissionModeColor || undefined} dimColor={footer.isRemoteMode}>
            {footer.permissionMode}
          </Text>
          <Text color={theme.dim ?? theme.muted} dimColor>
            {footer.cyclePermHint}
          </Text>
        </Text>
        <Text>
          {remoteSegment.map((seg, idx) => (
            <Text key={seg.key} color={pickColor(theme, seg.tone)} dimColor={seg.tone === "dim"}>
              {idx > 0 ? <Text dimColor> · </Text> : null}
              {seg.text}
            </Text>
          ))}
          {visibleRight.map((seg, idx) => (
            <Text key={seg.key} color={pickColor(theme, seg.tone)} dimColor={seg.tone === "dim"}>
              {remoteSegment.length > 0 || idx > 0 ? <Text dimColor> · </Text> : null}
              {seg.text}
            </Text>
          ))}
        </Text>
      </Box>
    );
  }

  // Wide (≥80 cols): two-line — StatusLine on top, metadata row below.
  const hasStatusLine = !!(footer.workspaceStatus || footer.runtimeStatus);
  const allRightSegments = [...remoteSegment, ...visibleRight];
  const reservedRight = allRightSegments.reduce(
    (acc, seg, idx) => acc + (seg.text?.length ?? 0) + (idx > 0 ? 3 : 0),
    0,
  );
  const leftBudget = Math.max(20, width - 4 - reservedRight - 2);
  const left = `${footer.permissionMode}${footer.cyclePermHint}`;
  const fittedLeft = left.length > leftBudget ? fitText(left, leftBudget) : left;

  return (
    <Box flexDirection="column" width={width} paddingX={2} paddingTop={1}>
      {hasStatusLine ? (
        <Box width="100%" flexShrink={0}>
          {footer.workspaceStatus ? (
            <Text dimColor>
              {shortenProtectionText(fitText(footer.workspaceStatus, width - 4))}
            </Text>
          ) : null}
          {footer.runtimeStatus ? (
            <Text dimColor>
              {shortenProtectionText(fitText(footer.runtimeStatus, width - 4))}
            </Text>
          ) : null}
        </Box>
      ) : null}
      <Box width="100%">
        <Box flexGrow={1} flexShrink={1}>
          <Text>
            <Text color={footer.permissionModeColor || undefined} dimColor={footer.isRemoteMode}>
              {footer.permissionMode}
            </Text>
            <Text color={theme.dim ?? theme.muted} dimColor>
              {fittedLeft.slice(footer.permissionMode.length)}
            </Text>
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text>
            {allRightSegments.map((seg, idx) => (
              <Text key={seg.key} color={pickColor(theme, seg.tone)} dimColor={seg.tone === "dim"}>
                {idx > 0 ? <Text dimColor> · </Text> : null}
                {seg.text}
              </Text>
            ))}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * #6 — Shorten file-protection / read-protection / scope-drift text to brief dim hints.
 * These are informational, not high-frequency main-screen content.
 */
function shortenProtectionText(text: string): string {
  return text
    .replace(/读取保护已启用/gu, "读保护")
    .replace(/文件保护已启用/gu, "文件保护")
    .replace(/文件保护成功/gu, "✓ 保护")
    .replace(/scope drift/giu, "范围变化")
    .replace(/architecture drift/giu, "架构变化")
    .replace(/Read protection enabled/giu, "read-protect")
    .replace(/File protection enabled/giu, "file-protect");
}

function pickColor(
  theme: ShellTheme,
  tone: "warning" | "dim" | "default" | undefined,
): string | undefined {
  if (tone === "warning") return theme.warning ?? theme.status.fail;
  if (tone === "dim") return theme.dim ?? theme.muted;
  return undefined;
}
