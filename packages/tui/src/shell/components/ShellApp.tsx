import { Box, Text } from "ink";
import type React from "react";
import type { TerminalCapability } from "../terminal-capability.js";
import {
  brandWordmark,
  composerMaxWidth,
  fitText,
  lineChar,
  taskComposerMaxWidth,
} from "../text-utils.js";
import { createShellTheme, getStatusMarker } from "../theme.js";
import type { ShellController, ShellViewModel, TaskActivityView } from "../types.js";
import { BtwPanel } from "./BtwPanel.js";
import { CommandPanel } from "./CommandPanel.js";
import { Composer } from "./Composer.js";
import { ConfigPanel } from "./ConfigPanel.js";
import { HelpPanel } from "./HelpPanel.js";
import { NotificationStack } from "./NotificationStack.js";
import { ProductBlock } from "./ProductBlock.js";
import { ScrollViewport } from "./ScrollViewport.js";
import { SessionsPanel } from "./SessionsPanel.js";
import { StatusFooter } from "./StatusFooter.js";
import { StatusTray } from "./StatusTray.js";
import { TaskSuggestionBar } from "./TaskSuggestionBar.js";

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
  const composerLine = lineChar(noColor, capability).repeat(cw);

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

      {/* Vision */}
      <Box marginTop={1} justifyContent="center">
        <Text color={theme.muted}>{fitText(view.homeVision, cw - 2)}</Text>
      </Box>

      {/* Setup hint (if needed) */}
      {view.setupHint ? (
        <Box marginTop={1} justifyContent="center" width={cw}>
          <Text color={theme.warning}>{fitText(view.setupHint, cw - 2)}</Text>
        </Box>
      ) : null}

      {/* Composer: single cursor owner */}
      <Box marginTop={1} flexDirection="column" width={cw}>
        <Text color={theme.accent}>{composerLine}</Text>
        <Composer view={view} onInput={controller.onInput} capability={capability} />
        <Text color={theme.accent}>{composerLine}</Text>
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
 *      index · optional hint. NOT the full StatusTray.
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
  const composerLine = lineChar(noColor, capability).repeat(cw);
  // D.14D-C2 Task Surface — 任务区滚动改用 ScrollViewport（测量 + 夹紧）。
  // 旧实现是无界的 marginTop={-scrollOffset}，offset 没有上界，用户可以一直
  // 向上滚动把内容整体推出可视区进入空白。ScrollViewport 量出内容/可视高度后
  // 把偏移夹到 [0, contentH-viewH]，并在 stickToBottom 时自动吸底。
  // C1：原来在 output 区与 composer 之间常驻的滚动提示行已删除（噪音），
  // footer 已承载状态；如需 hint 只在 footer/help 区，不在主流。
  return (
    <Box flexDirection="column" width={view.width} height={view.height}>
      {/* Output region: top-left, fills remaining vertical space. Long output
          gets the full terminal width; padding keeps the visual breathing room.
          ScrollViewport owns overflow=hidden + minHeight=0 and the measured,
          clamped translate; this wrapper only supplies padding + flexGrow. */}
      <Box flexDirection="column" flexGrow={1} minHeight={0} paddingX={2} paddingTop={1}>
        <ScrollViewport scroll={view.taskScroll}>
          {/* Permission > HelpPanel > BtwPanel > ConfigPanel 互斥渲染：
            - permission 优先级最高（已合并到 Composer 内的 PermissionControl card）；
            - HelpPanel / BtwPanel（D.13Q-UX Closure）次之；
            - ConfigPanel 只在没有 permission / helpPanel / btwPanel 时渲染。
            Composer 在任一面板打开时 useInput { isActive: false }，避免双消费。 */}
          {!view.permission && view.helpPanel ? (
            <HelpPanel
              panel={view.helpPanel}
              controller={controller}
              width={view.width - 4}
              noColor={noColor}
              language={view.language}
            />
          ) : null}
          {!view.permission && !view.helpPanel && view.btwPanel ? (
            <BtwPanel
              panel={view.btwPanel}
              controller={controller}
              width={view.width - 4}
              noColor={noColor}
              language={view.language}
            />
          ) : null}
          {!view.permission && !view.helpPanel && !view.btwPanel && view.sessionsPanel ? (
            <SessionsPanel
              panel={view.sessionsPanel}
              controller={controller}
              width={view.width - 4}
              noColor={noColor}
              language={view.language}
            />
          ) : null}
          {!view.permission &&
          !view.helpPanel &&
          !view.btwPanel &&
          !view.sessionsPanel &&
          view.configPanel ? (
            <ConfigPanel
              panel={view.configPanel}
              controller={controller}
              width={view.width - 4}
              noColor={noColor}
              language={view.language}
            />
          ) : null}
          {/* D.13Q-UX Task Surface — 通用 CommandPanel：当所有其他面板都关闭时，
            高级 slash 命令的输出走这里。与 transcript 隔离。 */}
          {!view.permission &&
          !view.helpPanel &&
          !view.btwPanel &&
          !view.sessionsPanel &&
          !view.configPanel &&
          view.commandPanel ? (
            <CommandPanel
              panel={view.commandPanel}
              controller={controller}
              width={view.width - 4}
              noColor={noColor}
              language={view.language}
            />
          ) : null}

          {/* C4：transcript 块区间距由 ProductBlock 自身的 marginBottom 统一负责，
            ShellApp 不再按 activity/permission 双加 marginTop（activity 已移到
            blocks 下方，旧的 view.activity 顶部间距已失效且会双重计入）。 */}
          {view.blocks.length > 0 ? (
            <Box flexDirection="column">
              {view.blocks.map((block) => (
                <ProductBlock key={block.id} block={block} theme={theme} width={view.width - 4} />
              ))}
            </Box>
          ) : null}

          {/* C3：activity / "thinking" 指示器渲染在 transcript 块**之后**（最新
            用户消息下方），与 CCB 行为一致（spinner 位于对话流底部），而不是
            压在更早的消息上方。blocks 存在时留 1 行间隔；首帧无 block 时贴顶。 */}
          {view.activity ? (
            <Box marginTop={view.blocks.length > 0 ? 1 : 0}>
              <ActivityIndicator activity={view.activity} theme={theme} />
            </Box>
          ) : null}

          {/* TaskSuggestionBar — 静态只读 hint 行；不接 useInput；空数组时不渲染。
            permission / tool_error / setup / slash 优先级，最多 4 条。 */}
          {view.taskSuggestions && view.taskSuggestions.length > 0 ? (
            <TaskSuggestionBar
              suggestions={view.taskSuggestions}
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
        </ScrollViewport>
      </Box>

      {/* Composer band — pinned bottom, left-aligned. flexShrink=0 prevents
          Yoga from collapsing the band when output is tall. Left alignment
          matches the Task page's full-width top-left output rhythm.
          Border-color rules use theme.border (muted) instead of theme.accent
          so the lines don't compete with content. */}
      <Box flexShrink={0} flexDirection="column">
        <Box flexDirection="column" width={cw}>
          <Text color={theme.border}>{composerLine}</Text>
          <Composer view={view} onInput={controller.onInput} capability={capability} />
          <Text color={theme.border}>{composerLine}</Text>
        </Box>

        {/* Task footer — minimal status line: permission mode · index. NOT the
            full StatusTray; the noisy line was identified as the
            "[Linghun] 会话…" leak source and stays out of Task mode.
            D.13Q-UX：迁到 StatusFooter（左 mode pill + cyclePermHint，右 model/cache/index/reasoning），
            window<60 走列向布局；model 占位时 dim，cache 低命中染 warning。 */}
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

        {/* D.13Q-UX：通知栈 — 右对齐，单条主显，绝不进 transcript。 */}
        <NotificationStack notifications={view.notifications} theme={theme} />

        {/* 底部呼吸：在 footer 与终端最底部之间留 1 行空白，避免 task footer
            贴在终端最后一行（光标 / 滚动条 / OS 任务栏会与之相邻不舒服）。
            flexShrink=0 确保 Yoga 不会在内容超长时把这一行吞掉。 */}
        <Box flexShrink={0} height={1} />
      </Box>
    </Box>
  );
}

// D.13Q-UX: 旧的 TaskFooter 组件已迁到 packages/tui/src/shell/components/StatusFooter.tsx。

function ActivityIndicator({
  activity,
  theme,
}: {
  activity: TaskActivityView;
  theme: ReturnType<typeof createShellTheme>;
}): React.ReactNode {
  // "completed" uses info color — NOT pass. Only verification results use pass.
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
  const marker =
    activity.phase === "completed"
      ? getStatusMarker("info", noColor)
      : activity.phase === "error"
        ? getStatusMarker("fail", noColor)
        : getStatusMarker("running", noColor);

  return (
    <Box>
      <Text color={color}>
        {marker} {activity.text}
      </Text>
    </Box>
  );
}
