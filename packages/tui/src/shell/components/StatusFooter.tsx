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

export type StatusFooterSegment = {
  key: string;
  text: string;
  tone?: "warning" | "dim" | "default";
  priority: number;
};

export function statusFooterCollapseMode(width: number): "wide" | "narrow" | "minimal" {
  if (width >= 80) return "wide";
  if (width >= 48) return "narrow";
  return "minimal";
}

export function selectStatusFooterSegments(input: {
  footer: TaskFooterView;
  width: number;
  modelDim?: boolean;
  cacheTone?: "default" | "warning" | "dim";
  gitBranch?: string;
}): StatusFooterSegment[] {
  const segments: StatusFooterSegment[] = [
    { key: "model", text: input.footer.model, tone: input.modelDim ? "dim" : "default", priority: 2 },
    { key: "index", text: input.footer.index, tone: "default", priority: 3 },
    {
      key: "cache",
      text: input.footer.cache,
      tone: input.cacheTone === "warning" ? "warning" : input.cacheTone === "dim" ? "dim" : "default",
      priority: 4,
    },
  ];
  if (input.footer.isRemoteMode) {
    segments.push({ key: "remote", text: "remote", tone: "dim", priority: 5 });
  }
  if (input.gitBranch) segments.push({ key: "branch", text: `⎇ ${input.gitBranch}`, tone: "dim", priority: 6 });
  if (input.footer.contextUsage) {
    segments.push({ key: "context", text: input.footer.contextUsage, tone: "dim", priority: 7 });
  }
  if (input.footer.reasoning) segments.push({ key: "reasoning", text: input.footer.reasoning, priority: 8 });

  const mode = statusFooterCollapseMode(input.width);
  const maxPriority = mode === "wide" ? 9 : mode === "narrow" ? 4 : 3;
  return segments
    .filter((segment) => segment.priority <= maxPriority)
    .sort((a, b) => a.priority - b.priority);
}

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
  const rightSegments = selectStatusFooterSegments({
    footer,
    width,
    modelDim,
    cacheTone,
    gitBranch,
  });

  if (statusFooterCollapseMode(width) !== "wide") {
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
          {rightSegments.map((seg, idx) => (
            <Text key={seg.key} color={pickColor(theme, seg.tone)} dimColor={seg.tone === "dim"}>
              {idx > 0 ? <Text dimColor> · </Text> : null}
              {fitText(seg.text, Math.max(6, Math.floor((width - 4) / rightSegments.length) - 3))}
            </Text>
          ))}
        </Text>
      </Box>
    );
  }

  // Wide (≥80 cols): two-line — StatusLine on top, metadata row below.
  const hasStatusLine = !!(footer.workspaceStatus || footer.runtimeStatus);
  const reservedRight = rightSegments.reduce(
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
            {rightSegments.map((seg, idx) => (
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
  return theme.brand;
}
