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
import type {
  ShellController,
  ShellViewModel,
  TaskActivityView,
  TaskFooterView,
  TaskPermissionView,
} from "../types.js";
import { Composer } from "./Composer.js";
import { ConfigPanel } from "./ConfigPanel.js";
import { ProductBlock } from "./ProductBlock.js";
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

  return (
    <Box flexDirection="column" width={view.width} height={view.height}>
      {/* Output region: top-left, fills remaining vertical space. Long output
          gets the full terminal width; padding keeps the visual breathing room.
          overflow=hidden + minHeight=0 prevents Yoga from shrinking children
          to zero when content overflows. */}
      <Box
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
        overflow="hidden"
        paddingX={2}
        paddingTop={1}
      >
        {view.activity ? <ActivityIndicator activity={view.activity} theme={theme} /> : null}

        {/* Permission > ConfigPanel 互斥渲染（D.13E Step 2 修正 #1）：
            permission 优先级最高；ConfigPanel 只在没有 permission 时渲染。
            Composer 在 ConfigPanel 渲染时 useInput { isActive: false }，避免双消费。 */}
        {view.permission ? (
          <PermissionPrompt
            permission={view.permission}
            theme={theme}
            width={view.width - 4}
            language={view.language}
          />
        ) : view.configPanel ? (
          <ConfigPanel
            panel={view.configPanel}
            controller={controller}
            width={view.width - 4}
            noColor={noColor}
            language={view.language}
          />
        ) : null}

        {view.blocks.length > 0 ? (
          <Box flexDirection="column" marginTop={view.activity || view.permission ? 1 : 0}>
            {view.blocks.map((block) => (
              <ProductBlock key={block.id} block={block} theme={theme} width={view.width - 4} />
            ))}
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
            "[Linghun] 会话…" leak source and stays out of Task mode. */}
        {view.taskFooter ? (
          <TaskFooter footer={view.taskFooter} theme={theme} width={view.width} />
        ) : null}

        {/* 底部呼吸：在 footer 与终端最底部之间留 1 行空白，避免 task footer
            贴在终端最后一行（光标 / 滚动条 / OS 任务栏会与之相邻不舒服）。
            flexShrink=0 确保 Yoga 不会在内容超长时把这一行吞掉。 */}
        <Box flexShrink={0} height={1} />
      </Box>
    </Box>
  );
}

function TaskFooter({
  footer,
  theme,
  width,
}: {
  footer: TaskFooterView;
  theme: ReturnType<typeof createShellTheme>;
  width: number;
}): React.ReactNode {
  // Production footer: 1 line of muted status with bottom breathing space.
  // Long sentences (e.g. setup hint) are intentionally NOT routed here —
  // permissionMode · index is the entire signal budget. An optional short
  // hint is supported for future per-flow needs but trimmed defensively.
  const segments: string[] = [footer.permissionMode, footer.index];
  if (footer.hint) segments.push(footer.hint);
  const line = segments.join(" · ");
  return (
    <Box width={width} paddingX={2} paddingTop={1}>
      <Text color={theme.muted}>{fitText(line, Math.max(20, width - 4))}</Text>
    </Box>
  );
}

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

function PermissionPrompt({
  permission,
  theme,
  width,
  language,
}: {
  permission: TaskPermissionView;
  theme: ReturnType<typeof createShellTheme>;
  width: number;
  language: ShellViewModel["language"];
}): React.ReactNode {
  const riskColor =
    permission.risk === "high"
      ? theme.status.fail
      : permission.risk === "medium"
        ? theme.status.blocked
        : theme.status.info;

  const riskLabel =
    permission.risk === "high"
      ? language === "en-US"
        ? "HIGH"
        : "高"
      : permission.risk === "medium"
        ? language === "en-US"
          ? "MEDIUM"
          : "中"
        : language === "en-US"
          ? "LOW"
          : "低";

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
      marginTop={1}
      width={Math.min(width, 76)}
    >
      <Text color={riskColor} bold>
        {permission.toolName} · {riskLabel}
      </Text>
      <Text>{fitText(permission.reason, width - 4)}</Text>
      {permission.scope.length > 0 ? (
        <Text color={theme.muted}>{fitText(permission.scope.join(", "), width - 4)}</Text>
      ) : null}
      <Text color={theme.accent}>{permission.hint}</Text>
    </Box>
  );
}
