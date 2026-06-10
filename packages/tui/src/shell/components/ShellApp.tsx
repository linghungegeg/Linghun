import { Box, type DOMElement, Text } from "@linghun/ink-runtime";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TerminalCapability } from "../terminal-capability.js";
import { resolveAlternateScreen } from "../ink-renderer.js";
import { resolveTerminalInteractionModes } from "../terminal-interaction-runtime.js";
import {
  brandWordmark,
  composerMaxWidth,
  fitText,
  taskComposerMaxWidth,
} from "../text-utils.js";
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
import { MouseInputRouter } from "./MouseInputRouter.js";
import { NotificationStack } from "./NotificationStack.js";
import { ProductBlock } from "./ProductBlock.js";
import { TranscriptViewport } from "./ScrollViewport.js";
import { SessionsPanel } from "./SessionsPanel.js";
import { StatusFooter } from "./StatusFooter.js";
import { StatusTray } from "./StatusTray.js";
import { TaskListView } from "./TaskListView.js";
import { TaskSuggestionBar } from "./TaskSuggestionBar.js";
import { WorkflowProgressView } from "./WorkflowProgressView.js";

export function ShellApp({
  controller,
  capability,
}: {
  controller: ShellController;
  capability: TerminalCapability;
}): React.ReactNode {
  const view = controller.getViewModel();
  const theme = createShellTheme(view.themeMode === "no-color");

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
            <ProductBlock key={block.id} block={block} theme={theme} width={view.width} />
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
  const mouseActive = useMemo(
    () => resolveTerminalInteractionModes({ capability, appOwnedScreen: resolveAlternateScreen(capability) }).mouseTracking,
    [capability],
  );
  const mouseSelectionActive = process.env.LINGHUN_TUI_MOUSE_SELECTION === "1";
  return (
    <Box flexDirection="column" width={view.width} height={view.height}>
      <Box flexDirection="column" flexGrow={1} minHeight={0} paddingX={2} paddingTop={1} position="relative">
        <TranscriptViewport
          scroll={view.transcriptScroll}
          virtualRange={view.transcriptVirtualRange}
          onMeasure={(measurement) => {
            queueMicrotask(() => {
              void controller.onInput({ type: "transcript-scroll-measure", ...measurement });
            });
          }}
          onGeometry={(geometry) => {
            queueMicrotask(() => {
              void controller.onInput({ type: "transcript-viewport-geometry", geometry });
            });
          }}
        >
          {/* C4：transcript 块区间距由 ProductBlock 自身的 marginBottom 统一负责，
            ShellApp 不再按 activity/permission 双加 marginTop（activity 已移到
            blocks 下方，旧的 view.activity 顶部间距已失效且会双重计入）。 */}
          {view.blocks.length > 0 ? (
            <Box flexDirection="column">
              {view.blocks.map((block) => (
                <MeasuredTranscriptBlock
                  key={block.id}
                  block={block}
                  controller={controller}
                  theme={theme}
                  cacheWidth={view.width}
                  width={view.width - 4}
                />
              ))}
            </Box>
          ) : null}

          {view.transcriptVirtualRange && view.transcriptVirtualRange.bottomSpacer > 0 ? (
            <Box height={view.transcriptVirtualRange.bottomSpacer} flexShrink={0} />
          ) : null}

          {view.streamingAssistantText ? (
            <Box marginTop={view.blocks.length > 0 ? 1 : 0}>
              <StreamingMarkdown
                text={view.streamingAssistantText}
                theme={theme}
                wrapWidth={Math.max(8, view.width - 4)}
              />
            </Box>
          ) : null}

          {/* C3：activity / "thinking" 指示器渲染在 transcript 块**之后**（最新
            用户消息下方），与 CCB 行为一致（spinner 位于对话流底部），而不是
            压在更早的消息上方。blocks 存在时留 1 行间隔；首帧无 block 时贴顶。 */}
          {view.activity ? (
            <Box marginTop={view.blocks.length > 0 || view.streamingAssistantText ? 1 : 0}>
              <ActivityIndicator
                activity={view.activity}
                theme={theme}
                tokenCount={estimateStreamingTokens(view.streamingAssistantText)}
              />
            </Box>
          ) : null}

          {/* TaskSuggestionBar — 空输入时可用 ↑/↓/Enter 或数字选择。 */}
          {view.taskListView ? (
            <TaskListView
              list={view.taskListView}
              width={view.width - 4}
              noColor={noColor}
              language={view.language}
            />
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
        </TranscriptViewport>
        <PanelLayer view={view} controller={controller} width={view.width - 4} noColor={noColor} />
      </Box>

      <MouseInputRouter
        active={mouseActive}
        selectionActive={mouseSelectionActive}
        scroll={view.transcriptScroll}
        onInput={(event) => { void controller.onInput(event); }}
      />

      {/* Composer band — pinned bottom, left-aligned. flexShrink=0 prevents
          Yoga from collapsing the band when output is tall. Left alignment
          matches the Task page's full-width top-left output rhythm.
          Border-color rules use theme.border (muted) instead of theme.accent
          so the lines don't compete with content. */}
      <Box flexShrink={0} flexDirection="column">
        {/* D.13Q-UX：轻提示固定在 composer 上方，不和 footer/runtime summary 抢最底部。 */}
        <NotificationStack notifications={view.notifications} theme={theme} />
        {view.taskRuntimeSummary ? (
          <Box width={cw} marginTop={1}>
            <ProductBlock block={view.taskRuntimeSummary} theme={theme} width={cw} />
          </Box>
        ) : null}

        {/* Agent & Workflow trees — fixed bottom above composer (CCB FullscreenLayout bottom: Spinner → PromptInput → Footer). */}
        {view.agentProgressTree ? (
          <Box width={cw}>
            <AgentProgressTree
              tree={view.agentProgressTree}
              width={cw}
              noColor={noColor}
              language={view.language}
            />
          </Box>
        ) : null}

        {view.workflowProgressView ? (
          <Box width={cw}>
            <WorkflowProgressView
              workflow={view.workflowProgressView}
              width={cw}
              noColor={noColor}
              language={view.language}
            />
          </Box>
        ) : null}

        <Box flexDirection="column" width={cw} paddingTop={1}>
          <Composer view={view} onInput={controller.onInput} capability={capability} />
        </Box>

        {/* Task footer — minimal status line: permission mode · model · cache · index · reasoning. NOT the
            full StatusTray; cost and background summaries stay out of the default Task surface.
            D.13Q-UX：迁到 StatusFooter（左 mode pill + cyclePermHint，右 model/cache/index/reasoning），
            window<60 走列向布局；model 占位时 dim。 */}
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

        {/* 底部呼吸：在 footer 与终端最底部之间留 1 行空白，避免 task footer
            贴在终端最后一行（光标 / 滚动条 / OS 任务栏会与之相邻不舒服）。
            flexShrink=0 确保 Yoga 不会在内容超长时把这一行吞掉。 */}
        <Box flexShrink={0} height={1} />
      </Box>
    </Box>
  );
}

// D.13Q-UX: 旧的 TaskFooter 组件已迁到 packages/tui/src/shell/components/StatusFooter.tsx。

function MeasuredTranscriptBlock({
  block,
  controller,
  theme,
  cacheWidth,
  width,
}: {
  block: ProductBlockViewModel;
  controller: ShellController;
  theme: ReturnType<typeof createShellTheme>;
  cacheWidth: number;
  width: number;
}): React.ReactNode {
  const ref = useRef<DOMElement | null>(null);
  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    const node = ref.current?.yogaNode;
    if (!node) return;
    const measuredWidth = Math.floor(node.getComputedWidth());
    const measuredHeight = Math.max(1, Math.floor(node.getComputedHeight()));
    const key = `${block.id}:${measuredWidth}:${measuredHeight}`;
    if (last.current === key) return;
    last.current = key;
    void controller.onInput({
      type: "transcript-block-measure",
      id: block.id,
      width: cacheWidth,
      height: measuredHeight,
    });
  });
  return (
    <Box ref={ref} flexDirection="column">
      <ProductBlock block={block} theme={theme} width={width} />
    </Box>
  );
}

function PanelLayer({
  view,
  controller,
  width,
  noColor,
}: {
  view: ShellViewModel;
  controller: ShellController;
  width: number;
  noColor: boolean;
}): React.ReactNode {
  if (view.permission) return null;

  // BackgroundTaskOverlay keeps its own frame (CCB PermissionDialog style).
  if (view.backgroundTaskOverlay) {
    return (
      <BackgroundTaskOverlay
        overlay={view.backgroundTaskOverlay}
        width={width}
        noColor={noColor}
      />
    );
  }

  // Pick the active panel content.
  const panel = resolvePanel(view, controller, width, noColor);
  if (!panel) return null;

  // CCB modal: absolute bottom-anchored overlay with ▔ divider, 2-row transcript peek.
  const columns = view.width;
  const maxPanelHeight = Math.max(4, view.height - 3);
  const theme = createShellTheme(noColor);
  return (
    <Box
      position="absolute"
      bottom={0}
      left={0}
      right={0}
      maxHeight={maxPanelHeight}
      flexDirection="column"
      overflow="hidden"
      opaque
    >
      <Box flexShrink={0}>
        <Text color={theme.permission ?? theme.muted}>
          {"▔".repeat(columns)}
        </Text>
      </Box>
      <Box flexDirection="column" paddingX={2} flexShrink={0} overflow="hidden">
        {panel}
      </Box>
    </Box>
  );
}

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
  useEffect(() => {
    if (activity.phase === "completed" || activity.phase === "error" || activity.phase === "permission_waiting") {
      return;
    }
    const timer = setInterval(() => setFrame((current) => current + 1), 100);
    return () => clearInterval(timer);
  }, [activity.phase]);

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
  const slow = seconds >= 8 && activity.phase !== "permission_waiting";
  const showTokenCount =
    seconds >= 30 && tokenCount !== undefined && (activity.phase === "thinking" || activity.phase === "continuing");
  const text = activityText(activity, frame);
  const showStats = activity.phase === "tool_running" && (activity.totalLines || activity.totalBytes);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color} bold={activity.phase === "thinking" && frame % 10 < 5}>
          {marker} {text}
        </Text>
        {activity.elapsed ? (
          <Text color={slow ? (theme.warning ?? theme.status.partial) : theme.muted} dimColor={!slow}>
            {" "}
            ({activity.elapsed})
          </Text>
        ) : null}
        {slow ? (
          <Text color={theme.muted} dimColor>
            {activity.language === "en-US" ? " · still working" : " · 仍在处理"}
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

function activityText(activity: TaskActivityView, frame: number): string {
  if (activity.phase !== "thinking") return activity.text;
  if (activity.text !== "Thinking…" && activity.text !== "正在思考…") return activity.text;
  const verbs = activity.text.startsWith("Thinking")
    ? ["Thinking", "Reading context", "Planning"]
    : ["正在思考", "正在阅读上下文", "正在规划"];
  const suffix = activity.text.endsWith("…") ? "…" : "";
  return `${verbs[Math.floor(frame / 10) % verbs.length] ?? verbs[0]}${suffix}`;
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
