import { Box, Static, Text } from "@linghun/ink-runtime";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { resolveAlternateScreen } from "../ink-renderer.js";
import type { TerminalCapability } from "../terminal-capability.js";
import { brandWordmark, composerMaxWidth, fitText, taskComposerMaxWidth } from "../text-utils.js";
import { createShellTheme, getStatusMarker } from "../theme.js";
import type { ShellController, ShellViewModel, TaskActivityView } from "../types.js";
import type { ProductBlockViewModel } from "../types.js";
import { AgentProgressTree } from "./AgentProgressTree.js";
import { BackgroundTaskOverlay } from "./BackgroundTaskOverlay.js";
import { BtwPanel } from "./BtwPanel.js";
import { CommandPanel } from "./CommandPanel.js";
import { Composer } from "./Composer.js";
import { ConfigPanel } from "./ConfigPanel.js";
import { HelpPanel } from "./HelpPanel.js";
import { StreamingMarkdown } from "./MessageMarkdown.js";
import { NotificationStack } from "./NotificationStack.js";
import { ProductBlock } from "./ProductBlock.js";
import { SessionsPanel } from "./SessionsPanel.js";
import { StatusFooter } from "./StatusFooter.js";
import { StatusTray } from "./StatusTray.js";
import { TaskListView } from "./TaskListView.js";
import { TaskSuggestionBar } from "./TaskSuggestionBar.js";
import { UnseenMessagePill } from "./UnseenMessagePill.js";
import { WorkflowProgressView } from "./WorkflowProgressView.js";

const TASK_RECENT_TAIL_BLOCKS = 6;

export function ShellApp({
  controller,
  capability,
}: {
  controller: ShellController;
  capability: TerminalCapability;
}): React.ReactNode {
  const view = controller.getViewModel();
  const theme = useMemo(() => createShellTheme(view.themeMode === "no-color"), [view.themeMode]);

  // Panel active → independent fullscreen (no overlay, no workspace-cell conflict).
  // Composer MUST be mounted for keyboard input routing — all panel navigation
  // (help-select, command-panel-move, etc.) flows through Composer's useInput.
  // It's rendered at height=0 so it registers its input handler without taking
  // any terminal cells.
  const panel = resolvePanel(view, controller, view.width, view.themeMode === "no-color");
  if (panel) {
    const cardWidth = Math.min(view.width - 4, 80);
    return (
      <Box
        width={view.width}
        height={view.height}
        flexDirection="column"
        backgroundColor={theme.background}
        alignItems="center"
      >
        <Box flexGrow={1} minHeight={0} />
        <Box flexShrink={0} width={cardWidth}>
          <Text color={theme.dim ?? theme.muted} dimColor>
            {"─".repeat(cardWidth)}
          </Text>
        </Box>
        <Box flexDirection="column" paddingTop={1} flexShrink={1} overflow="hidden" width={cardWidth}>
          {panel}
        </Box>
        <Box flexShrink={0} width={cardWidth}>
          <Text color={theme.dim ?? theme.muted} dimColor>
            {"─".repeat(cardWidth)}
          </Text>
        </Box>
        <Box flexGrow={1} minHeight={0} />
        {view.taskFooter ? (
          <StatusFooter
            footer={view.taskFooter}
            theme={theme}
            width={view.width}
            language={view.language}
            modelDim={view.taskFooter.modelDim}
            cacheTone={view.taskFooter.cacheTone}
          />
        ) : null}
        {/* Headless Composer — keyboard routing only, zero visual footprint. */}
        <Box height={0} overflow="hidden">
          <Composer view={view} onInput={controller.onInput} capability={capability} />
        </Box>
      </Box>
    );
  }

  if (view.viewMode === "task" || view.viewMode === "pending") {
    return <TaskLayout view={view} theme={theme} controller={controller} capability={capability} />;
  }
  return <HomeLayout view={view} theme={theme} controller={controller} capability={capability} />;
}

function HomeLayout({
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
  const cw = composerMaxWidth(view.width);
  const brandLines = brandWordmark(noColor, view.width, capability);

  return (
    <Box
      flexDirection="column"
      width={view.width}
      height={view.height}
      alignItems="center"
      justifyContent="center"
    >
      <Box flexGrow={1} minHeight={0} />

      {/* Brand wordmark: ASCII-safe on legacy terminals */}
      <Box flexDirection="column" alignItems="center">
        {brandLines.map((line) => (
          <Text key={line || "empty"} color={theme.brand} bold>
            {line}
          </Text>
        ))}
      </Box>

      {view.homeVision ? (
        <Box marginTop={1} justifyContent="center">
          <Text color={theme.muted}>{fitText(view.homeVision, cw - 2)}</Text>
        </Box>
      ) : null}

      {/* Setup hint (if needed) */}
      {view.setupHint ? (
        <Box marginTop={1} justifyContent="center" width={cw}>
          <Text color={theme.warning}>{fitText(view.setupHint, cw - 2)}</Text>
        </Box>
      ) : null}

      {/* Composer: single cursor owner */}
      <Box marginTop={1} flexDirection="column" width={cw}>
        <Composer view={view} onInput={controller.onInput} capability={capability} />
      </Box>

      {/* Status tray */}
      <Box marginTop={1} justifyContent="center">
        <StatusTray status={view.status} theme={theme} width={view.width} />
      </Box>

      {view.blocks.length > 0 ? (
        <Box flexDirection="column" marginTop={1} width={cw}>
          {view.blocks.map((block) => (
            <ProductBlock
              key={block.id}
              block={block}
              theme={theme}
              width={view.width}
              language={view.language}
            />
          ))}
        </Box>
      ) : null}

      {view.limitations.length > 0 ? (
        <Box flexDirection="column" marginTop={1} width={cw}>
          {view.limitations.map((item) => (
            <Text key={item} color={theme.muted}>
              {item}
            </Text>
          ))}
        </Box>
      ) : null}

      <Box flexGrow={2} minHeight={0} />
    </Box>
  );
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
  const cw = taskComposerMaxWidth(view.width);
  const contentWidth = Math.max(8, view.width - 4);

  // Periodic re-render tick: when agent/workflow progress is visible, force
  // re-renders so eviction timers fire and completed items disappear.
  const [, setTick] = useState(0);
  const hasProgress = !!(view.agentProgressTree || view.workflowProgressView);
  useEffect(() => {
    if (!hasProgress) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [hasProgress]);

  const staticBlocks = view.blocks.filter((b) => b.status !== "running");
  const dynamicBlocks = view.blocks.filter((b) => b.status === "running");
  const staticHistoryBlocks = staticBlocks.slice(
    0,
    Math.max(0, staticBlocks.length - TASK_RECENT_TAIL_BLOCKS),
  );
  const recentStaticBlocks = staticBlocks.slice(-TASK_RECENT_TAIL_BLOCKS);
  const currentBlocks = [...recentStaticBlocks, ...dynamicBlocks];

  return (
    <Box flexDirection="column" width={view.width} height={view.height}>
      {/* Main content area — native terminal scrollback plus a current-screen tail near composer. */}
      <Box flexDirection="column" flexGrow={1} minHeight={0} justifyContent="flex-end">
        <Static items={staticHistoryBlocks}>
          {(block) => (
            <Box key={block.id} paddingX={2}>
              <ProductBlock
                block={block}
                theme={theme}
                width={contentWidth}
                language={view.language}
              />
            </Box>
          )}
        </Static>
        <Box flexDirection="column" paddingX={2}>
          {currentBlocks.length > 0 ? (
            <Box flexDirection="column">
              {currentBlocks.map((block) => (
                <ProductBlock
                  key={block.id}
                  block={block}
                  theme={theme}
                  width={contentWidth}
                  language={view.language}
                />
              ))}
            </Box>
          ) : null}

          {view.streamingAssistantText ? (
            <Box marginTop={currentBlocks.length > 0 ? 1 : 0}>
              <StreamingMarkdown
                text={view.streamingAssistantText}
                theme={theme}
                wrapWidth={contentWidth}
              />
            </Box>
          ) : null}

          {view.activity ? (
            <Box marginTop={currentBlocks.length > 0 || view.streamingAssistantText ? 1 : 0}>
              <ActivityIndicator
                activity={view.activity}
                theme={theme}
                tokenCount={estimateStreamingTokens(view.streamingAssistantText)}
              />
            </Box>
          ) : null}

          {view.taskSuggestions && view.taskSuggestions.length > 0 ? (
            <TaskSuggestionBar
              suggestions={view.taskSuggestions}
              cursor={view.taskSuggestionCursor ?? 0}
              width={view.width}
              noColor={noColor}
            />
          ) : null}

          {view.limitations.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              {view.limitations.map((item) => (
                <Text key={item} color={theme.muted}>
                  {item}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
        {view.unseenMessageCount && view.unseenMessageCount > 0 ? (
          <UnseenMessagePill
            count={view.unseenMessageCount}
            language={view.language}
            width={view.width}
          />
        ) : null}
      </Box>

      {/* Composer band — pinned to terminal bottom */}
      <Box flexShrink={0} flexDirection="column">
        {view.backgroundTaskOverlay && !view.permission ? (
          <BackgroundTaskOverlay
            overlay={view.backgroundTaskOverlay}
            width={contentWidth}
            noColor={noColor}
          />
        ) : null}
        {/* P1-7: ConfigPanel as overlay, preserving scroll ability */}
        {view.configPanel ? (
          <ConfigPanel
            panel={view.configPanel}
            controller={controller}
            width={view.width}
            noColor={noColor}
            language={view.language}
          />
        ) : null}
        <NotificationStack notifications={view.notifications} theme={theme} />
        {view.taskRuntimeSummary ? (
          <Box width={cw} marginTop={1}>
            <ProductBlock
              block={view.taskRuntimeSummary}
              theme={theme}
              width={cw}
              language={view.language}
            />
          </Box>
        ) : null}

        {view.taskListView ? (
          <Box paddingX={2} marginBottom={1}>
            <TaskListView
              list={view.taskListView}
              width={contentWidth}
              noColor={noColor}
              language={view.language}
            />
          </Box>
        ) : null}

        {view.agentProgressTree ? (
          <Box width={view.width} paddingX={2}>
            <AgentProgressTree
              tree={view.agentProgressTree}
              width={contentWidth}
              noColor={noColor}
              language={view.language}
            />
          </Box>
        ) : null}

        {view.workflowProgressView ? (
          <Box width={view.width} paddingX={2}>
            <WorkflowProgressView
              workflow={view.workflowProgressView}
              width={contentWidth}
              noColor={noColor}
              language={view.language}
            />
          </Box>
        ) : null}

        <Box flexDirection="column" width={cw} paddingTop={1}>
          <Composer view={view} onInput={controller.onInput} capability={capability} />
        </Box>

        {view.taskFooter ? (
          <StatusFooter
            footer={view.taskFooter}
            theme={theme}
            width={view.width}
            language={view.language}
            modelDim={view.taskFooter.modelDim}
            cacheTone={view.taskFooter.cacheTone}
          />
        ) : null}
      </Box>
    </Box>
  );
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
  // P1-7: ConfigPanel moved to overlay mode, no longer fullscreen
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

function ActivityIndicator({
  activity,
  theme,
  tokenCount,
}: {
  activity: TaskActivityView;
  theme: ReturnType<typeof createShellTheme>;
  tokenCount?: number;
}): React.ReactNode {
  const [frame, setFrame] = useState(0);
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

  useEffect(() => {
    if (
      activity.phase === "completed" ||
      activity.phase === "error" ||
      activity.phase === "permission_waiting"
    ) {
      return;
    }
    const timer = setInterval(() => setFrame((current) => current + 1), 100);
    return () => clearInterval(timer);
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
      <Box>
        {isToolHeader ? (
          <>
            <Text color={theme.toolRunning ?? color}>
              {marker}{" "}
            </Text>
            <Text bold color={theme.toolRunning ?? color}>
              {activity.toolName}
            </Text>
            {activity.toolTarget ? (
              <Text color={theme.muted}>({activity.toolTarget})</Text>
            ) : null}
          </>
        ) : (
          <Text color={color} bold={activity.phase === "thinking" && frame % 10 < 5}>
            {marker} {text}
          </Text>
        )}
        {activity.elapsed ? (
          <Text
            color={slow ? (theme.warning ?? theme.status.partial) : theme.muted}
            dimColor={!slow}
          >
            {" "}
            ({activity.elapsed})
          </Text>
        ) : null}
        {slowText ? (
          <Text color={theme.muted} dimColor>
            {slowText}
          </Text>
        ) : null}
        {showTokenCount ? (
          <Text color={theme.muted} dimColor>
            {activity.language === "en-US" ? ` · ${tokenCount} tokens` : ` · ${tokenCount} tokens`}
          </Text>
        ) : null}
      </Box>
      {showStats ? (
        <Box>
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
  if (activity.phase === "permission_waiting" || activity.phase === "completed" || activity.phase === "error") {
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
