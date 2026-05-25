import { Box, Text } from "ink";
import type React from "react";
import type { TerminalCapability } from "../terminal-capability.js";
import { brandWordmark, composerMaxWidth, fitText, lineChar } from "../text-utils.js";
import { createShellTheme, getStatusMarker } from "../theme.js";
import type {
  ShellController,
  ShellViewModel,
  TaskActivityView,
  TaskPermissionView,
} from "../types.js";
import { Composer } from "./Composer.js";
import { ProductBlock } from "./ProductBlock.js";
import { StatusTray } from "./StatusTray.js";

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
  const cw = composerMaxWidth(view.width);
  const composerLine = lineChar(noColor, capability).repeat(cw);

  return (
    <Box flexDirection="column" width={view.width} height={view.height}>
      {/* Compact top bar: brand + status */}
      <Box justifyContent="space-between" width={view.width} paddingX={1}>
        <Text color={theme.brand} bold>
          {view.brand}
        </Text>
        <StatusTray status={view.status} theme={theme} width={view.width - 12} />
      </Box>

      {/* Separator */}
      <Box paddingX={1}>
        <Text color={theme.muted}>
          {lineChar(noColor, capability).repeat(Math.max(10, view.width - 2))}
        </Text>
      </Box>

      {/* Main content area */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} minHeight={0}>
        {/* Activity indicator */}
        {view.activity ? <ActivityIndicator activity={view.activity} theme={theme} /> : null}

        {/* Permission prompt */}
        {view.permission ? (
          <PermissionPrompt permission={view.permission} theme={theme} width={cw} />
        ) : null}

        {/* Output blocks */}
        {view.blocks.length > 0 ? (
          <Box flexDirection="column" marginTop={view.activity || view.permission ? 1 : 0}>
            {view.blocks.map((block) => (
              <ProductBlock key={block.id} block={block} theme={theme} width={view.width - 2} />
            ))}
          </Box>
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

      {/* Composer at bottom — single cursor owner for entire shell */}
      <Box flexDirection="column" width={cw} alignSelf="center">
        <Text color={theme.accent}>{composerLine}</Text>
        <Composer view={view} onInput={controller.onInput} capability={capability} />
        <Text color={theme.accent}>{composerLine}</Text>
      </Box>
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
}: {
  permission: TaskPermissionView;
  theme: ReturnType<typeof createShellTheme>;
  width: number;
}): React.ReactNode {
  const riskColor =
    permission.risk === "high"
      ? theme.status.fail
      : permission.risk === "medium"
        ? theme.status.blocked
        : theme.status.info;

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
        {permission.toolName}
      </Text>
      <Text>{fitText(permission.reason, width - 4)}</Text>
      {permission.scope.length > 0 ? (
        <Text color={theme.muted}>{fitText(permission.scope.join(", "), width - 4)}</Text>
      ) : null}
      <Text color={theme.accent}>{permission.hint}</Text>
    </Box>
  );
}
