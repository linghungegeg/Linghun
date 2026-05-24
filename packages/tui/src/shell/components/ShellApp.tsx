import { Box, Text } from "ink";
import type React from "react";
import { createShellTheme } from "../theme.js";
import type { ShellController } from "../types.js";
import { Composer } from "./Composer.js";
import { ProductBlock } from "./ProductBlock.js";
import { StatusTray } from "./StatusTray.js";

export function ShellApp({ controller }: { controller: ShellController }): React.ReactNode {
  const view = controller.getViewModel();
  const theme = createShellTheme(view.themeMode === "no-color");
  const compact = view.width < 60;
  return (
    <Box flexDirection="column" paddingX={compact ? 0 : 1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.accent}>{view.homeTitle}</Text>
        <Text>{view.homeSummary}</Text>
        <StatusTray status={view.status} theme={theme} width={view.width} />
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        {view.blocks.map((block) => (
          <ProductBlock key={block.id} block={block} theme={theme} width={view.width} />
        ))}
      </Box>
      <Composer view={view} onInput={controller.onInput} />
      {view.limitations.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {view.limitations.map((item) => (
            <Text key={item} color={theme.muted}>
              - {item}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
