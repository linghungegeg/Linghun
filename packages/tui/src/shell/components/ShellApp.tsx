import { Box, Text, useStdout } from "ink";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createShellTheme } from "../theme.js";
import type { ShellController } from "../types.js";
import { Composer } from "./Composer.js";
import { ProductBlock } from "./ProductBlock.js";
import { StatusTray } from "./StatusTray.js";

export function ShellApp({ controller }: { controller: ShellController }): React.ReactNode {
  useResizeRerender(controller);
  const view = controller.getViewModel();
  const theme = createShellTheme(view.themeMode === "no-color");
  const composerMaxWidth = Math.min(76, Math.max(40, view.width - 4));

  return (
    <Box
      flexDirection="column"
      width={view.width}
      height={view.height}
      alignItems="center"
      justifyContent="center"
    >
      <Box flexGrow={1} minHeight={0} />

      <Box justifyContent="center">
        <Text color={theme.brand} bold>
          {view.brand}
        </Text>
      </Box>

      <Box justifyContent="center" marginTop={1}>
        <Text color={theme.muted}>{fitText(view.homeVision, composerMaxWidth)}</Text>
      </Box>

      <Box marginTop={1} justifyContent="center">
        <StatusTray status={view.status} theme={theme} width={view.width} />
      </Box>

      {view.setupHint ? (
        <Box marginTop={1} justifyContent="center" width={composerMaxWidth}>
          <Text color={theme.warning} dimColor>
            {fitText(view.setupHint, composerMaxWidth - 2)}
          </Text>
        </Box>
      ) : null}

      <Box marginTop={1} width={composerMaxWidth}>
        <Text color={theme.accent}>{"|"} </Text>
        <Composer view={view} onInput={controller.onInput} />
      </Box>

      {view.blocks.length > 0 ? (
        <Box flexDirection="column" marginTop={1} width={composerMaxWidth}>
          {view.blocks.map((block) => (
            <ProductBlock key={block.id} block={block} theme={theme} width={view.width} />
          ))}
        </Box>
      ) : null}

      {view.limitations.length > 0 ? (
        <Box flexDirection="column" marginTop={1} width={composerMaxWidth}>
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

function fitText(value: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(value.replace(/\s+/gu, " ").trim());
  let width = 0;
  let result = "";
  for (const char of chars) {
    const next = width + charWidth(char);
    if (next > max) return `${result}…`;
    result += char;
    width = next;
  }
  return result;
}

function charWidth(char: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(
    char,
  )
    ? 2
    : 1;
}

function useResizeRerender(controller: ShellController): void {
  const { stdout } = useStdout();
  const [, setVersion] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const rerenderOnResize = () => {
      controller.onResize?.();
      // Clear the alternate screen buffer to remove stale lines from vertical resize
      // (shrink leaves old bottom content, grow leaves gaps)
      stdout.write("\x1b[2J\x1b[H");
      // Immediate rerender for new dimensions
      setVersion((v) => v + 1);
      // Schedule a second rerender on next tick to ensure clean paint
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setVersion((v) => v + 1);
        timerRef.current = null;
      }, 32);
    };
    stdout.on("resize", rerenderOnResize);
    return () => {
      stdout.off("resize", rerenderOnResize);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [controller, stdout]);
}
