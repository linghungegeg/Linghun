import type { Readable, Writable } from "node:stream";
import { render } from "@linghun/ink-runtime";
import React from "react";
import { isNativeScrollbackEnabled } from "../tui-output-surface.js";
import { ShellApp } from "./components/ShellApp.js";
import {
  nativeScrollbackTaskHasFullscreenPanel,
  nativeScrollbackTaskFrameHasContent,
  nativeScrollbackTaskFrameHeight,
  shouldUseNativeScrollbackTaskFrame,
} from "./native-scrollback-frame.js";
import { type TerminalCapability, detectTerminalCapability } from "./terminal-capability.js";
import {
  bindTerminalInteractionSignals,
  createTerminalInteractionSession,
  DISABLE_ALTERNATE_SCROLL,
  DISABLE_SGR_MOUSE,
  resolveTerminalInteractionModes,
  writeBestEffort,
} from "./terminal-interaction-runtime.js";
import { drainStdin, writeSGRResetAndFlush } from "./stdout-flush-barrier.js";
import { recoverTerminalState } from "./terminal-state-recovery.js";
import type { ShellController, ShellRenderOptions } from "./types.js";

export type InkShellInstance = {
  rerender: () => void;
  clear: () => void;
  clearTransientFrame: () => void;
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
  waitUntilRenderFlush: () => Promise<void>;
};

type InkStdout = NodeJS.WriteStream & { __linghunRawStdout?: NodeJS.WriteStream };
type NativeScrollbackFrameGeometry = {
  topRow: number;
  height: number;
  bottomRow: number;
};
const RERENDER_FRAME_MS = 16;
const ENTER_ALTERNATE_SCREEN = "\x1B[?1049h";
const EXIT_ALTERNATE_SCREEN = "\x1B[?1049l";

export function shouldUseInkShell(input: Readable, output: Writable): boolean {
  if (process.env.LINGHUN_TUI_PLAIN === "1") return false;
  if (process.env.TERM === "dumb") return false;
  if ((input as { isTTY?: boolean }).isTTY !== true) return false;
  if ((output as { isTTY?: boolean }).isTTY !== true) return false;

  // Ink works on any TTY with cursor positioning �?alternate screen is optional.
  // Only truly incapable terminals (legacy Windows cmd conhost) fall to plain.
  const capability = detectTerminalCapability();
  if (!capability.cursorPositioning) return false;

  return true;
}

export function renderInkShell(
  controller: ShellController,
  options: ShellRenderOptions = {},
): InkShellInstance {
  const stdout = options.stdout as NodeJS.WriteStream | undefined;
  const capability = detectTerminalCapability();
  const useAlternateScreen = resolveAlternateScreen(capability);
  const normalScreenWheel = !useAlternateScreen && shouldEnableNormalScreenWheel(capability);
  let lastNativeScrollbackFrameGeometry: NativeScrollbackFrameGeometry | undefined;
  const inkStdout = createInkStdout(stdout, () => ({
    current: resolveNativeScrollbackFrameGeometry(controller, useAlternateScreen),
    previous: lastNativeScrollbackFrameGeometry,
  }));
  const terminalInteractionModes = resolveTerminalInteractionModes({
    capability,
    appOwnedScreen: useAlternateScreen,
    normalScreenWheel,
  });
  const terminalInteractionSession = createTerminalInteractionSession(
    stdout,
    terminalInteractionModes,
  );
  const terminalInteractionSignals = bindTerminalInteractionSignals(
    process,
    terminalInteractionSession,
  );
  let instance: ReturnType<typeof render>;
  let lastRenderAt = 0;
  let renderGeneration = 0;
  let pendingRenderTimer: ReturnType<typeof setTimeout> | undefined;
  let lastNativeScrollbackFullscreenPanelActive = false;
  let manualPanelAlternateScreenActive = false;

  try {
    disableNormalScreenMouseModes(stdout, useAlternateScreen, normalScreenWheel);
    lastNativeScrollbackFullscreenPanelActive = nativeScrollbackFullscreenPanelActive(
      controller,
      useAlternateScreen,
    );
    if (lastNativeScrollbackFullscreenPanelActive) {
      resetScrollRegion(stdout, useAlternateScreen);
      if (!useAlternateScreen) {
        writeBestEffort(stdout, `${ENTER_ALTERNATE_SCREEN}\x1B[2J\x1B[H`);
        manualPanelAlternateScreenActive = true;
      } else {
        writeBestEffort(stdout, "\x1B[2J\x1B[H");
      }
    } else {
      anchorNativeScrollbackFrame(controller, stdout, useAlternateScreen);
      enforceFrameScrollRegion(controller, stdout, useAlternateScreen);
    }
    lastNativeScrollbackFrameGeometry = resolveNativeScrollbackFrameGeometry(
      controller,
      useAlternateScreen,
    );
    terminalInteractionSession.enable();
    instance = render(
      <ShellApp
        key={`shell-render:${renderGeneration}`}
        controller={controller}
        capability={capability}
        renderTick={renderGeneration}
      />,
      {
        stdin: options.stdin as NodeJS.ReadStream | undefined,
        stdout: inkStdout,
        stderr: options.stderr as NodeJS.WriteStream | undefined,
        exitOnCtrlC: false,
        alternateScreen: useAlternateScreen,
      },
    );
  } catch (error) {
    // Phase 6: Terminal state recovery on render startup error
    terminalInteractionSession.disable();
    void recoverTerminalState(stdout, {
      exitAlternateScreen: useAlternateScreen,
      logError: (msg) => {
        const stderr = options.stderr as NodeJS.WriteStream | undefined;
        stderr?.write(`[linghun] ${msg}\n`);
      },
    }).catch(() => {
      // Recovery failed, but still throw original error
    });
    throw error;
  }

  let unmounted = false;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let waitUntilExitPromise: Promise<void> | undefined;
  const doUnmount = () => {
    if (unmounted) return;
    unmounted = true;
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = undefined;
    }
    if (pendingRenderTimer) {
      clearTimeout(pendingRenderTimer);
      pendingRenderTimer = undefined;
    }
    terminalInteractionSignals.dispose();
    stdout?.off("resize", onResize);
    stdinStream?.off("close", doUnmount);
    stdinStream?.off("end", doUnmount);
    stdinStream?.off("error", doUnmount);
    stdout?.off("close", doUnmount);
    stdout?.off("error", doUnmount);
    try {
      instance.unmount();
    } catch {
      // stdout/stdin may already be closed (e.g. Windows cmd window close)
    }
    terminalInteractionSession.disable();

    if (manualPanelAlternateScreenActive) {
      writeBestEffort(stdout, EXIT_ALTERNATE_SCREEN);
      manualPanelAlternateScreenActive = false;
    }

    // Reset scroll region on unmount so the terminal is fully usable again
    resetScrollRegion(stdout);

    // Phase 6: Exit cleanup - drain stdin and reset SGR state (async, non-blocking)
    drainStdin(stdinStream);
    void writeSGRResetAndFlush(stdout).catch(() => {
      // Best-effort: ignore flush errors during unmount
    });

    showTerminalCursor(stdout);
    // Unref stdin to prevent the process from hanging on exit
    const stdin = options.stdin as { unref?: () => void } | undefined;
    stdin?.unref?.();
  };

  const rerenderNow = () => {
    if (unmounted) return;
    lastRenderAt = Date.now();
    try {
      options.beforeRender?.();
      const fullscreenPanelActive = nativeScrollbackFullscreenPanelActive(
        controller,
        useAlternateScreen,
      );
      if (fullscreenPanelActive !== lastNativeScrollbackFullscreenPanelActive) {
        resetScrollRegion(stdout, useAlternateScreen);
        if (!useAlternateScreen) {
          if (fullscreenPanelActive) {
            writeBestEffort(stdout, `${ENTER_ALTERNATE_SCREEN}\x1B[2J\x1B[H`);
            manualPanelAlternateScreenActive = true;
          } else {
            writeBestEffort(stdout, EXIT_ALTERNATE_SCREEN);
            manualPanelAlternateScreenActive = false;
            resetScrollRegion(stdout, useAlternateScreen);
            clearNativeScrollbackVisibleViewport(stdout);
            clearNativeScrollbackFrame(
              controller,
              stdout,
              useAlternateScreen,
              lastNativeScrollbackFrameGeometry,
            );
            anchorNativeScrollbackFrame(controller, stdout, useAlternateScreen);
          }
        } else {
          writeBestEffort(stdout, "\x1B[2J\x1B[H");
        }
        renderGeneration += 1;
      }
      lastNativeScrollbackFullscreenPanelActive = fullscreenPanelActive;
      const currentFrameGeometry = resolveNativeScrollbackFrameGeometry(
        controller,
        useAlternateScreen,
      );
      if (
        currentFrameGeometry &&
        lastNativeScrollbackFrameGeometry &&
        nativeScrollbackFrameGeometryChanged(
          currentFrameGeometry,
          lastNativeScrollbackFrameGeometry,
        ) &&
        clearNativeScrollbackFrame(
          controller,
          stdout,
          useAlternateScreen,
          lastNativeScrollbackFrameGeometry,
        )
      ) {
        renderGeneration += 1;
      }
      lastNativeScrollbackFrameGeometry = currentFrameGeometry;
      if (!fullscreenPanelActive) {
        enforceFrameScrollRegion(controller, stdout, useAlternateScreen);
      }
      instance.rerender(
        <ShellApp
          key={`shell-render:${renderGeneration}`}
          controller={controller}
          capability={capability}
          renderTick={renderGeneration}
        />,
      );
    } catch (error) {
      // Phase 6/7: Log rerender error but do NOT call recoverTerminalState here.
      // This is a mid-session error (e.g. stream-close race) �?the terminal session
      // is still active and the interaction session manages modes. Heavy-handed
      // recovery (cursor show, mouse disable, SGR reset) would interfere with the
      // ongoing session. Full recovery runs only on unmount/exit.
      const stderr = options.stderr as NodeJS.WriteStream | undefined;
      const message = error instanceof Error ? error.message : String(error);
      stderr?.write(`[linghun] Render error: ${message}\n`);
    }
  };

  const rerender = () => {
    if (unmounted) return;
    const elapsed = Date.now() - lastRenderAt;
    if (elapsed >= RERENDER_FRAME_MS) {
      if (pendingRenderTimer) {
        clearTimeout(pendingRenderTimer);
        pendingRenderTimer = undefined;
      }
      rerenderNow();
      return;
    }
    pendingRenderTimer ??= setTimeout(() => {
      pendingRenderTimer = undefined;
      rerenderNow();
    }, RERENDER_FRAME_MS - elapsed);
  };

  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    const previousFrameGeometry = lastNativeScrollbackFrameGeometry;
    if (!useAlternateScreen && lastNativeScrollbackFrameGeometry) {
      resetScrollRegion(stdout);
      clearNativeScrollbackVisibleViewport(stdout);
      clearNativeScrollbackFrameUnion(stdout, lastNativeScrollbackFrameGeometry);
    }
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      if (unmounted) return;
      // Resize changes the terminal's physical wrap width. In app-owned
      // alternate screen, reassert modes and let Ink redraw the frame in-place.
      // Native scrollback rows are terminal-owned and append-only. Windows
      // Terminal can reflow the old live frame into the top of the viewport
      // while a resize drag is in progress, so resize must clear the current
      // visible viewport before repainting the bottom live frame. This does not
      // send 3J and does not clear the terminal scrollback buffer.
      if (!useAlternateScreen) {
        resetScrollRegion(stdout);
        controller.onResize?.();
        const nextFrameGeometry = resolveNativeScrollbackFrameGeometry(controller, useAlternateScreen);
        clearNativeScrollbackVisibleViewport(stdout);
        clearNativeScrollbackFrameUnion(stdout, previousFrameGeometry, nextFrameGeometry);
        renderGeneration += 1;
      }
      terminalInteractionSession.reassert();
      disableNormalScreenMouseModes(stdout, useAlternateScreen, normalScreenWheel);
      if (useAlternateScreen) controller.onResize?.();
      anchorNativeScrollbackFrame(controller, stdout, useAlternateScreen);
      lastNativeScrollbackFrameGeometry = resolveNativeScrollbackFrameGeometry(
        controller,
        useAlternateScreen,
      );
      rerenderNow();
      // Note: Viewport clamp happens automatically in ScrollViewport's useEffect
      // after rerender measures new dimensions and calls onMeasure callback
    }, 60);
  };

  // Handle stdin/stdout close/error (Windows cmd window close, pipe break)
  const stdinStream = options.stdin as NodeJS.ReadStream | undefined;
  stdinStream?.on("close", doUnmount);
  stdinStream?.on("end", doUnmount);
  stdinStream?.on("error", doUnmount);
  stdout?.on("close", doUnmount);
  stdout?.on("error", doUnmount);
  stdout?.on("resize", onResize);

  return {
    rerender,
    clear: () => instance.clear(),
    clearTransientFrame: () => {
      options.beforeClearTransientFrame?.();
      renderGeneration += 1;
      if (resolveNativeScrollbackFrameAnchorRow(controller, useAlternateScreen)) {
        clearNativeScrollbackFrame(
          controller,
          stdout,
          useAlternateScreen,
          lastNativeScrollbackFrameGeometry,
        );
      } else {
        instance.clear();
        writeBestEffort(stdout, "\x1B[2J\x1B[H");
      }
      anchorNativeScrollbackFrame(controller, stdout, useAlternateScreen);
      lastNativeScrollbackFrameGeometry = resolveNativeScrollbackFrameGeometry(
        controller,
        useAlternateScreen,
      );
    },
    unmount: doUnmount,
    waitUntilExit: async () => {
      if (unmounted) return;
      waitUntilExitPromise ??= instance.waitUntilExit().then(() => undefined);
      await waitUntilExitPromise;
    },
    waitUntilRenderFlush: async () => {
      if (pendingRenderTimer) {
        clearTimeout(pendingRenderTimer);
        pendingRenderTimer = undefined;
        rerenderNow();
      }
      await instance.waitUntilRenderFlush();
    },
  };
}

export function resolveAlternateScreen(capability: TerminalCapability): boolean {
  // Full-screen Ink shell owns the screen by default when the terminal can
  // safely provide an alternate buffer. Plain/headless/pipe paths never reach
  // this renderer, and LINGHUN_FULLSCREEN=0 keeps the normal-screen fallback.
  if (isNativeScrollbackEnabled()) return false;
  if (process.env.LINGHUN_FULLSCREEN === "0") return false;
  if (!capability.alternateScreen) return false;
  if (process.env.TMUX_PANE || process.env.TERM_PROGRAM === "tmux") return false;
  return true;
}

function anchorNativeScrollbackFrame(
  controller: ShellController,
  stdout: NodeJS.WriteStream | undefined,
  useAlternateScreen: boolean,
): void {
  const row = resolveNativeScrollbackFrameAnchorRow(controller, useAlternateScreen);
  if (!row) return;
  writeBestEffort(stdout, `\x1B[${row};1H`);
}

function clearNativeScrollbackFrame(
  controller: ShellController,
  stdout: NodeJS.WriteStream | undefined,
  useAlternateScreen: boolean,
  previousFrame?: NativeScrollbackFrameGeometry,
): boolean {
  const frame = resolveNativeScrollbackFrameGeometry(controller, useAlternateScreen);
  if (!frame) return false;
  resetScrollRegion(stdout, useAlternateScreen);
  clearNativeScrollbackFrameUnion(stdout, previousFrame, frame);
  return true;
}

function clearNativeScrollbackFrameUnion(
  stdout: NodeJS.WriteStream | undefined,
  ...frames: Array<NativeScrollbackFrameGeometry | undefined>
): void {
  const clearFrom = nativeScrollbackFrameClearFromRow(stdout?.rows, frames);
  if (!clearFrom) return;
  writeBestEffort(stdout, `\x1B[${clearFrom};1H\x1B[J`);
}

function clearNativeScrollbackVisibleViewport(stdout: NodeJS.WriteStream | undefined): void {
  writeBestEffort(stdout, "\x1B[1;1H\x1B[J");
}

function nativeScrollbackFrameClearFromRow(
  terminalRows: number | undefined,
  frames: Array<NativeScrollbackFrameGeometry | undefined>,
): number | undefined {
  const presentFrames = frames.filter(
    (frame): frame is NativeScrollbackFrameGeometry => frame !== undefined,
  );
  if (presentFrames.length === 0) return undefined;
  const maxKnownBottom = Math.max(...presentFrames.map((frame) => frame.bottomRow));
  const currentRows = Math.max(1, Math.floor(terminalRows ?? maxKnownBottom ?? 24));
  const candidates: number[] = [];
  for (const frame of presentFrames) {
    candidates.push(Math.max(1, Math.min(frame.topRow, currentRows)));
    const height = Math.max(1, frame.height);
    candidates.push(Math.max(1, currentRows - height + 1));
  }
  return Math.min(...candidates);
}

function resolveNativeScrollbackFrameGeometry(
  controller: ShellController,
  useAlternateScreen: boolean,
): NativeScrollbackFrameGeometry | undefined {
  if (useAlternateScreen || !shouldUseNativeScrollbackTaskFrame()) return undefined;
  const view = controller.getViewModel();
  if (view.viewMode !== "task" && view.viewMode !== "pending") return undefined;
  if (nativeScrollbackTaskHasFullscreenPanel(view)) return undefined;
  const terminalRows = Math.max(1, Math.floor(view.height));
  const frameHeight = nativeScrollbackTaskFrameHeight(view);
  const topRow = Math.max(1, Math.floor(terminalRows - frameHeight + 1));
  const bottomRow = terminalRows;
  return { topRow, height: bottomRow - topRow + 1, bottomRow };
}

function nativeScrollbackFrameGeometryChanged(
  next: NativeScrollbackFrameGeometry,
  previous: NativeScrollbackFrameGeometry,
): boolean {
  return (
    next.topRow !== previous.topRow ||
    next.height !== previous.height ||
    next.bottomRow !== previous.bottomRow
  );
}

function resolveNativeScrollbackFrameAnchorRow(
  controller: ShellController,
  useAlternateScreen: boolean,
): number | undefined {
  return resolveNativeScrollbackFrameGeometry(controller, useAlternateScreen)?.topRow;
}

function nativeScrollbackFullscreenPanelActive(
  controller: ShellController,
  useAlternateScreen: boolean,
): boolean {
  if (useAlternateScreen || !shouldUseNativeScrollbackTaskFrame()) return false;
  const view = controller.getViewModel();
  if (view.viewMode !== "task" && view.viewMode !== "pending") return false;
  return nativeScrollbackTaskHasFullscreenPanel(view);
}

function disableNormalScreenMouseModes(
  stdout: NodeJS.WriteStream | undefined,
  useAlternateScreen: boolean,
  normalScreenWheel: boolean,
): void {
  if (useAlternateScreen) return;
  if (normalScreenWheel) return;
  writeBestEffort(stdout, `${DISABLE_SGR_MOUSE}${DISABLE_ALTERNATE_SCROLL}`);
}

function shouldEnableNormalScreenWheel(capability: TerminalCapability): boolean {
  if (!capability.cursorPositioning) return false;
  return process.env.LINGHUN_TUI_MOUSE === "1";
}

function showTerminalCursor(stdout: NodeJS.WriteStream | undefined): void {
  writeBestEffort(stdout, "\x1B[?25h");
}

function resetScrollRegion(stdout: NodeJS.WriteStream | undefined, useAlternateScreen?: boolean): void {
  if (useAlternateScreen) return;
  writeBestEffort(stdout, "\x1B[r");
}

function enforceFrameScrollRegion(
  controller: ShellController,
  stdout: NodeJS.WriteStream | undefined,
  useAlternateScreen: boolean,
): void {
  const anchorRow = resolveNativeScrollbackFrameAnchorRow(controller, useAlternateScreen);
  if (!anchorRow) return;
  const rows = stdout?.rows;
  if (!rows || rows < 2) return;
  writeBestEffort(stdout, `\x1B[${anchorRow};${rows}r\x1B[${anchorRow};1H`);
}

function createInkStdout(
  stdout: NodeJS.WriteStream | undefined,
  resolveFrameGeometry?: () => {
    current?: NativeScrollbackFrameGeometry;
    previous?: NativeScrollbackFrameGeometry;
  },
): NodeJS.WriteStream | undefined {
  if (!stdout) return undefined;
  const wrapped = Object.create(stdout) as InkStdout;
  wrapped.__linghunRawStdout = stdout;
  let lastPaintedFrameGeometry: NativeScrollbackFrameGeometry | undefined;

  // Ink's log-update emits: [returnPrefix] + eraseLines(N) + content + [cursorSuffix]
  // eraseLines(N) = (\x1B[2K\x1B[1A){N-1} \x1B[2K \x1B[G  (for N>=1)
  // returnPrefix  = \x1B[?25l + cursorDown(M) + \x1B[G  (only when cursor was shown)
  // These are relative cursor ops that escape the frame region.
  // We strip them and replace with absolute frame-row paints so normal-screen
  // redraws cannot scroll the terminal when the cursor is on the bottom row.
  //
  // Pattern breakdown:
  //   optional BSU: \x1B[?2026h
  //   optional hideCursor: \x1B[?25l
  //   optional returnToBottom: \x1B[<N>B \x1B[G  (cursorDown + cursorTo(0))
  //   eraseLines: (\x1B[2K\x1B[1A)* \x1B[2K \x1B[G
  // cursorTo(0) in ansi-escapes = \x1B[1G (not \x1B[G); eraseLines ends with cursorLeft = \x1B[G
  const ERASE_LINES_RE =
    /^(\x1B\[\?2026h)?(\x1B\[\?25l)?(\x1B\[\d+B\x1B\[1G|\x1B\[1G)?(\x1B\[2K(\x1B\[1A\x1B\[2K)*\x1B\[G)/;

  wrapped.write = ((chunk: unknown, ...args: unknown[]) => {
    const rewrite = (value: string): string => {
      let next = value.replace(/\x1B\[3J/g, "");
      const frameGeometryState = resolveFrameGeometry?.();
      const frameGeometry = frameGeometryState?.current;
      const anchorRow = frameGeometry?.topRow;
      if (anchorRow) {
        const clearFromRow = nativeScrollbackFrameClearFromRow(stdout.rows, [
          lastPaintedFrameGeometry,
          frameGeometryState?.previous,
          frameGeometry,
        ]);
        let fullClearRequested = false;
        next = next.replace(/\x1B\[2J\x1B\[H/g, () => {
          fullClearRequested = true;
          return "";
        });
        const m = ERASE_LINES_RE.exec(next);
        if (m) {
          const bsu = m[1] || "";
          const stripped = next.slice(m[0].length);
          lastPaintedFrameGeometry = frameGeometry;
          return `${bsu}\x1B[?25l${paintNativeScrollbackFrame(anchorRow, stdout.rows, stripped, {
            clearFromRow,
          })}`;
        }
        if (fullClearRequested) {
          lastPaintedFrameGeometry = frameGeometry;
          return paintNativeScrollbackFrame(anchorRow, stdout.rows, next, { clearFromRow });
        }
        lastPaintedFrameGeometry = frameGeometry;
      } else {
        lastPaintedFrameGeometry = undefined;
      }
      return next;
    };
    const next =
      typeof chunk === "string"
        ? rewrite(chunk)
        : Buffer.isBuffer(chunk)
          ? Buffer.from(rewrite(chunk.toString()))
          : chunk;
    return (stdout.write as (...writeArgs: unknown[]) => boolean).call(stdout, next, ...args);
  }) as NodeJS.WriteStream["write"];
  return wrapped;
}

function paintNativeScrollbackFrame(
  anchorRow: number,
  terminalRows: number | undefined,
  content: string,
  options: { clear?: boolean; clearFromRow?: number } = {},
): string {
  const frameRows = terminalRows ? Math.max(1, terminalRows - anchorRow + 1) : undefined;
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "").split("\n");
  const visibleLines = frameRows ? lines.slice(0, frameRows) : lines;
  const clearFromRow = options.clearFromRow ?? (options.clear ? anchorRow : undefined);
  const clearPrefix = clearFromRow ? `\x1B[${clearFromRow};1H\x1B[J` : "";
  return `${clearPrefix}${visibleLines
    .map((line, index) => `\x1B[${anchorRow + index};1H${line}\x1B[K`)
    .join("")}`;
}

export function isNoColorTerminal(): boolean {
  return process.env.NO_COLOR === "1" || process.env.FORCE_COLOR === "0";
}

/** Re-export for external consumers. */
export { detectTerminalCapability } from "./terminal-capability.js";
export type { TerminalCapability } from "./terminal-capability.js";
