import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { resolveAlternateScreen } from "../ink-renderer.js";
import {
  nativeScrollbackTaskFrameHasContent,
  nativeScrollbackTaskFrameHeight,
  shouldUseNativeScrollbackTaskFrame,
} from "../native-scrollback-frame.js";
import type { TerminalCapability } from "../terminal-capability.js";
import { taskComposerMaxWidth } from "../text-utils.js";
import { createShellTheme, getStatusMarker } from "../theme.js";
import type { ShellController, ShellViewModel, TaskActivityView } from "../types.js";
import { BtwPanel } from "./BtwPanel.js";
import { CommandPanel } from "./CommandPanel.js";
import { Composer, type ComposerLayout } from "./Composer.js";
import { ConfigPanel } from "./ConfigPanel.js";
import { HelpPanel } from "./HelpPanel.js";
import { StreamingMarkdown } from "./MessageMarkdown.js";
import { MouseInputRouter } from "./MouseInputRouter.js";
import { ProductBlock } from "./ProductBlock.js";
import { TranscriptViewport } from "./ScrollViewport.js";
import { SessionsPanel } from "./SessionsPanel.js";
import { TaskBottomPane } from "./TaskBottomPane.js";
import { TaskSuggestionBar } from "./TaskSuggestionBar.js";
import { UnseenMessagePill } from "./UnseenMessagePill.js";

export function ShellApp({
  controller,
  capability,
  renderTick,
}: {
  controller: ShellController;
  capability: TerminalCapability;
  renderTick?: number;
}): React.ReactNode {
  void renderTick;
  const view = controller.getViewModel();
  const theme = useMemo(() => createShellTheme(view.themeMode === "no-color"), [view.themeMode]);

  // Panel active → independent fullscreen (no overlay, no workspace-cell conflict).
  // Composer MUST be mounted for keyboard input routing — all panel navigation
  // (help-select, command-panel-move, etc.) flows through Composer's useInput.
  // It's rendered at height=0 so it registers its input handler without taking
  // any terminal cells.
  const panel = resolvePanel(view, controller, view.width, view.themeMode === "no-color");
  if (panel) {
    return (
      <Box
        width={view.width}
        height={view.height}
        flexDirection="column"
        backgroundColor={theme.background}
      >
        <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" width={view.width}>
          {panel}
        </Box>
        {/* Headless Composer — keyboard routing only, zero visual footprint. */}
        <Box height={0} overflow="hidden">
          <Composer
            view={view}
            onInput={controller.onInput}
            capability={capability}
            layout={taskComposerLayout(view.width)}
          />
        </Box>
      </Box>
    );
  }

  return <TaskLayout view={view} theme={theme} controller={controller} capability={capability} />;
}

/**
 * TaskLayout — production-grade task interaction shell.
 *
 * Layout (top → bottom, full-page top-left):
 *   1. output region (flexGrow=1, overflow=hidden) — activity, permission
 *      card, blocks (including slash command transcript rows), limitations.
 *   2. composer band (flexShrink=0) — accent rule, Composer (which renders
 *      the permission action row above the buffer when permission is active),
 *      accent rule.
 *   3. task footer (flexShrink=0) — single low-key line: permission mode ·
 *      model · cache · index · reasoning. NOT the full StatusTray.
 *
 * The whole task region is left-aligned: no `alignItems="center"` and no
 * symmetric width clamp on the output column, so long output uses the full
 * terminal width. The composer band is the only thing that keeps the cw width
 * for cursor-coordinate stability with Home.
 *
 * Permission exclusivity: the Composer hides the native cursor while the
 * permission card is on screen (see useAnchoredCursor's null branch), so the
 * permission selector row is the sole focus owner.
 */
function TaskLayout({
  view,
  theme,
  controller,
  capability,
}: {
  view: ShellViewModel;
  theme: ReturnType<typeof createShellTheme>;
  controller: ShellController;
  capability: TerminalCapability;
}): React.ReactNode {
  const noColor = view.themeMode === "no-color";
  const contentWidth = taskContentWidth(view.width);
  const appOwnedScreen = resolveAlternateScreen(capability);
  const normalScreenNativeScrollback = !appOwnedScreen && shouldUseNativeScrollbackTaskFrame();
  const nativeFrameHasContent = nativeScrollbackTaskFrameHasContent(view);
  const normalScreenWheel = !appOwnedScreen && capability.cursorPositioning && process.env.LINGHUN_TUI_MOUSE === "1";
  const frameHeight = normalScreenNativeScrollback
    ? nativeScrollbackTaskFrameHeight(view)
    : view.height;
  const terminalFrameTop = normalScreenNativeScrollback
    ? Math.max(0, view.height - frameHeight)
    : 0;
  const wheelRouterActive = appOwnedScreen || normalScreenWheel;
  const mouseSelectionActive = process.env.LINGHUN_TUI_MOUSE_SELECTION === "1";
  const transcriptBlocks = mergeTranscriptBlocks(view.staticHistoryBlocks ?? [], view.blocks);
  const visibleTranscriptBlocks = normalScreenNativeScrollback
    ? view.blocks
    : transcriptBlocks;
  const expandedTranscriptBlock =
    view.ctrlOExpand?.active && view.ctrlOExpand.blockId
      ? visibleTranscriptBlocks.find((block) => block.id === view.ctrlOExpand?.blockId)
      : undefined;

  // Shared local pulse for task progress eviction and activity animation. Keep
  // these React-owned refreshes on one interval so they do not compete while
  // transcript streaming/scrolling is also requesting frames through the shell.
  const [framePulse, setFramePulse] = useState(0);
  const hasProgress = !!(view.agentProgressTree || view.workflowProgressView);
  const hasAnimatedActivity =
    !!view.activity &&
    view.activity.phase !== "completed" &&
    view.activity.phase !== "error" &&
    view.activity.phase !== "permission_waiting";
  useEffect(() => {
    if (!hasProgress && !hasAnimatedActivity) return;
    const intervalMs = hasAnimatedActivity ? 100 : 1000;
    const timer = setInterval(() => setFramePulse((frame) => frame + 1), intervalMs);
    return () => clearInterval(timer);
  }, [hasProgress, hasAnimatedActivity]);

  return (
    <Box flexDirection="column" width={view.width} height={frameHeight}>
      {/* Single dynamic transcript surface: resize must reflow every visible block without replaying Static output. */}
      <Box
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
        overflow="hidden"
        justifyContent={normalScreenNativeScrollback && nativeFrameHasContent ? "flex-end" : undefined}
      >
        {normalScreenNativeScrollback ? null : (
          <MouseInputRouter
            wheelActive={wheelRouterActive}
            mouseActive={appOwnedScreen}
            selectionActive={mouseSelectionActive}
            scroll={view.transcriptScroll}
            onInput={controller.onInput}
          />
        )}
        {normalScreenNativeScrollback ? (
          <Box flexDirection="column" flexShrink={0} paddingX={2} paddingTop={1}>
            <TaskActivityRegion
              activity={undefined}
              expandedTranscriptBlock={expandedTranscriptBlock}
              framePulse={framePulse}
              limitations={view.limitations}
              noColor={noColor}
              streamingAssistantText={view.streamingAssistantText}
              language={view.language}
              taskSuggestions={view.taskSuggestions}
              taskSuggestionCursor={view.taskSuggestionCursor}
              theme={theme}
              transcriptBlocks={visibleTranscriptBlocks}
              viewWidth={view.width}
              contentWidth={contentWidth}
              capability={capability}
            />
          </Box>
        ) : (
          <TranscriptViewport
            scroll={view.transcriptScroll}
            virtualRange={view.transcriptVirtualRange}
            onMeasure={({ viewportHeight, contentHeight }) =>
              controller.onInput({ type: "transcript-scroll-measure", viewportHeight, contentHeight })
            }
            onGeometry={(geometry) => {
              controller.onInput({
                type: "transcript-viewport-geometry",
                geometry:
                  terminalFrameTop > 0
                    ? { ...geometry, y: geometry.y + terminalFrameTop }
                    : geometry,
              });
            }}
          >
            <Box flexDirection="column" paddingX={2}>
              <TaskActivityRegion
                activity={view.activity}
                expandedTranscriptBlock={expandedTranscriptBlock}
                framePulse={framePulse}
                limitations={view.limitations}
                noColor={noColor}
                streamingAssistantText={view.streamingAssistantText}
                language={view.language}
                taskSuggestions={view.taskSuggestions}
                taskSuggestionCursor={view.taskSuggestionCursor}
                theme={theme}
                transcriptBlocks={visibleTranscriptBlocks}
                viewWidth={view.width}
                contentWidth={contentWidth}
                capability={capability}
              />
            </Box>
          </TranscriptViewport>
        )}
        {view.unseenMessageCount && view.unseenMessageCount > 0 ? (
          <UnseenMessagePill
            count={view.unseenMessageCount}
            language={view.language}
            width={view.width}
          />
        ) : null}
      </Box>

      <TaskBottomPane
        view={view}
        controller={controller}
        capability={capability}
        frameHeight={frameHeight}
        contentWidth={contentWidth}
        noColor={noColor}
        theme={theme}
      />
    </Box>
  );
}

function taskContentWidth(viewWidth: number): number {
  // paddingX=2 consumes four terminal cells. Keep output width aligned with
  // the actual content column so markdown/code/diff wrap once at the visible
  // boundary instead of being squeezed by an extra hidden reserve.
  return Math.max(8, viewWidth - 4);
}

function TaskActivityRegion({
  activity,
  contentWidth,
  capability,
  expandedTranscriptBlock,
  framePulse,
  limitations,
  language,
  noColor,
  streamingAssistantText,
  taskSuggestions,
  taskSuggestionCursor,
  theme,
  transcriptBlocks,
  viewWidth,
}: {
  activity: ShellViewModel["activity"];
  contentWidth: number;
  capability: TerminalCapability;
  expandedTranscriptBlock: ShellViewModel["blocks"][number] | undefined;
  framePulse: number;
  limitations: ShellViewModel["limitations"];
  language: ShellViewModel["language"];
  noColor: boolean;
  streamingAssistantText: ShellViewModel["streamingAssistantText"];
  taskSuggestions: ShellViewModel["taskSuggestions"];
  taskSuggestionCursor: ShellViewModel["taskSuggestionCursor"];
  theme: ReturnType<typeof createShellTheme>;
  transcriptBlocks: ShellViewModel["blocks"];
  viewWidth: number;
}): React.ReactNode {
  const hasTranscript = Boolean(expandedTranscriptBlock || transcriptBlocks.length > 0);
  const hasStreaming = Boolean(streamingAssistantText);

  return (
    <>
      {expandedTranscriptBlock ? (
        <Box flexDirection="column" marginBottom={1}>
          <ProductBlock
            block={{ ...expandedTranscriptBlock, ctrlOCollapsed: false }}
            theme={theme}
            width={contentWidth}
            language={language}
            capability={capability}
          />
        </Box>
      ) : transcriptBlocks.length > 0 ? (
        <Box flexDirection="column">
          {transcriptBlocks.map((block) => (
            <ProductBlock
              key={block.id}
              block={block}
              theme={theme}
              width={contentWidth}
              language={language}
              capability={capability}
            />
          ))}
        </Box>
      ) : null}

      {streamingAssistantText ? (
        <Box marginTop={1}>
          <StreamingMarkdown
            text={streamingAssistantText}
            theme={theme}
            wrapWidth={contentWidth}
            useAsciiBorders={noColor || !capability.unicodeBox}
          />
        </Box>
      ) : null}

      {activity ? (
        <Box marginTop={1}>
          <ActivityIndicator
            activity={activity}
            theme={theme}
            width={contentWidth}
            frame={framePulse}
            tokenCount={estimateStreamingTokens(streamingAssistantText)}
          />
        </Box>
      ) : null}

      {taskSuggestions && taskSuggestions.length > 0 ? (
        <TaskSuggestionBar
          suggestions={taskSuggestions}
          cursor={taskSuggestionCursor ?? 0}
          width={viewWidth}
          noColor={noColor}
        />
      ) : null}

      {limitations.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {limitations.map((item) => (
            <Text key={item} color={theme.muted}>
              {item}
            </Text>
          ))}
        </Box>
      ) : null}
    </>
  );
}

function taskComposerLayout(viewWidth: number): ComposerLayout {
  return {
    width: taskComposerMaxWidth(viewWidth),
    paddingLeft: 2,
    paddingRight: 2,
    prefixWidth: 2,
    minContentWidth: 4,
  };
}

// D.13Q-UX: 旧的 TaskFooter 组件已迁到 packages/tui/src/shell/components/StatusFooter.tsx。

function resolvePanel(
  view: ShellViewModel,
  controller: ShellController,
  width: number,
  noColor: boolean,
): React.ReactNode {
  if (view.helpPanel) {
    return (
      <HelpPanel
        panel={view.helpPanel}
        controller={controller}
        width={width}
        noColor={noColor}
        language={view.language}
      />
    );
  }
  if (view.btwPanel) {
    return (
      <BtwPanel
        panel={view.btwPanel}
        controller={controller}
        width={width}
        noColor={noColor}
        language={view.language}
      />
    );
  }
  if (view.sessionsPanel) {
    return (
      <SessionsPanel
        panel={view.sessionsPanel}
        controller={controller}
        width={width}
        noColor={noColor}
        language={view.language}
      />
    );
  }
  if (view.configPanel) {
    return (
      <ConfigPanel
        panel={view.configPanel}
        controller={controller}
        width={width}
        noColor={noColor}
        language={view.language}
      />
    );
  }
  if (view.commandPanel) {
    return (
      <CommandPanel
        panel={view.commandPanel}
        controller={controller}
        width={width}
        noColor={noColor}
        language={view.language}
      />
    );
  }
  return null;
}

function mergeTranscriptBlocks(
  staticHistoryBlocks: ShellViewModel["staticHistoryBlocks"],
  liveBlocks: ShellViewModel["blocks"],
): ShellViewModel["blocks"] {
  if (!staticHistoryBlocks || staticHistoryBlocks.length === 0) return liveBlocks;
  if (liveBlocks.length === 0) return staticHistoryBlocks;
  const seen = new Set(staticHistoryBlocks.map((block) => block.id));
  const liveOnlyBlocks = liveBlocks.filter((block) => !seen.has(block.id));
  return liveOnlyBlocks.length > 0
    ? [...staticHistoryBlocks, ...liveOnlyBlocks]
    : staticHistoryBlocks;
}

function ActivityIndicator({
  activity,
  theme,
  width,
  frame,
  tokenCount,
}: {
  activity: TaskActivityView;
  theme: ReturnType<typeof createShellTheme>;
  width: number;
  frame: number;
  tokenCount?: number;
}): React.ReactNode {
  // Auto-hide completed/error terminal phases after 1.2s so the indicator
  // doesn't linger once the answer is already visible in the transcript.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (activity.phase === "completed" || activity.phase === "error") {
      const hideTimer = setTimeout(() => setHidden(true), 1200);
      return () => clearTimeout(hideTimer);
    }
    setHidden(false);
    return;
  }, [activity.phase]);

  if (hidden) return null;

  const colorMap: Record<TaskActivityView["phase"], string | undefined> = {
    thinking: theme.status.running,
    tool_running: theme.status.running,
    permission_waiting: theme.status.blocked,
    continuing: theme.status.info,
    completed: theme.status.info,
    error: theme.status.fail,
  };
  const color = colorMap[activity.phase];
  const noColor = theme.mode === "no-color";
  const marker = activityMarker(activity.phase, frame, noColor);
  const seconds = parseElapsedSeconds(activity.elapsed);
  const slow = seconds >= 10 && activity.phase !== "permission_waiting";
  const showTokenCount =
    seconds >= 30 &&
    tokenCount !== undefined &&
    (activity.phase === "thinking" || activity.phase === "continuing");
  const text = activityText(activity, tokenCount);
  const slowText = slow ? slowActivityText(activity, tokenCount) : undefined;
  const showStats =
    activity.phase === "tool_running" && (activity.totalLines || activity.totalBytes);
  // Phase 2: tool_running with toolName renders CCB-style "● Edit(router.ts)  3s"
  const isToolHeader = activity.phase === "tool_running" && activity.toolName;
  return (
    <Box flexDirection="column">
      <Box width={width}>
        {isToolHeader ? (
          <>
            <Text wrap="wrap" color={theme.toolRunning ?? color}>
              {marker}{" "}
            </Text>
            <Text wrap="wrap" bold color={theme.toolRunning ?? color}>
              {activity.toolName}
            </Text>
            {activity.toolTarget ? (
              <Text wrap="wrap" color={theme.muted}>
                ({activity.toolTarget})
              </Text>
            ) : null}
          </>
        ) : (
          <Text wrap="wrap" color={color} bold={activity.phase === "thinking" && frame % 10 < 5}>
            {marker} {text}
          </Text>
        )}
        {activity.elapsed ? (
          <Text
            wrap="wrap"
            color={slow ? (theme.warning ?? theme.status.partial) : theme.muted}
            dimColor={!slow}
          >
            {" "}
            ({activity.elapsed})
          </Text>
        ) : null}
        {slowText ? (
          <Text wrap="wrap" color={theme.muted} dimColor>
            {slowText}
          </Text>
        ) : null}
        {showTokenCount ? (
          <Text wrap="wrap" color={theme.muted} dimColor>
            {activity.language === "en-US" ? ` · ${tokenCount} tokens` : ` · ${tokenCount} tokens`}
          </Text>
        ) : null}
      </Box>
      {showStats ? (
        <Box width={width}>
          <Text dimColor>
            {"   "}
            {activity.totalLines
              ? activity.language === "en-US"
                ? `~${activity.totalLines} lines`
                : `~${activity.totalLines} 行`
              : null}
            {activity.totalLines && activity.totalBytes ? " · " : null}
            {activity.totalBytes ? formatFileSize(activity.totalBytes) : null}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function activityMarker(phase: TaskActivityView["phase"], frame: number, noColor: boolean): string {
  if (phase === "completed") return getStatusMarker("info", noColor);
  if (phase === "error") return getStatusMarker("fail", noColor);
  if (phase === "permission_waiting") return getStatusMarker("blocked", noColor);
  if (noColor) return ["-", "\\", "|", "/"][frame % 4] ?? "-";
  // ● blink: visible frames 0-2, hidden frames 3-5 (600ms cycle at 100ms tick)
  return frame % 6 < 3 ? "●" : " ";
}

function activityText(activity: TaskActivityView, tokenCount?: number): string {
  if (
    tokenCount !== undefined &&
    tokenCount > 0 &&
    (activity.phase === "thinking" || activity.phase === "continuing")
  ) {
    return activity.language === "en-US" ? "Generating answer…" : "生成回答中…";
  }
  if (activity.phase !== "thinking") return activity.text;
  if (activity.thinkingLabel) return activity.thinkingLabel;
  return activity.text;
}

function slowActivityText(activity: TaskActivityView, tokenCount?: number): string | undefined {
  const isEn = activity.language === "en-US";
  if (
    activity.phase === "permission_waiting" ||
    activity.phase === "completed" ||
    activity.phase === "error"
  ) {
    return undefined;
  }
  if (activity.phase === "tool_running") {
    return isEn ? " · tool still running" : " · 工具仍在运行";
  }
  if (tokenCount !== undefined && tokenCount > 0) {
    return isEn ? " · still generating" : " · 持续生成";
  }
  if (activity.phase === "continuing") {
    return isEn ? " · processing result" : " · 处理结果中";
  }
  return isEn ? " · waiting for model" : " · 等待模型";
}

function parseElapsedSeconds(elapsed: string | undefined): number {
  if (!elapsed) return 0;
  const matches = [...elapsed.matchAll(/(\d+)\s*(h|m|s)/giu)];
  if (matches.length === 0) return 0;
  let seconds = 0;
  for (const match of matches) {
    const value = Number(match[1] ?? 0);
    const unit = (match[2] ?? "s").toLowerCase();
    seconds += unit === "h" ? value * 3600 : unit === "m" ? value * 60 : value;
  }
  return seconds;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

function estimateStreamingTokens(text: string | undefined): number | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}
