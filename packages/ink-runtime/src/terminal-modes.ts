import type { Writable } from "node:stream";

export const ENABLE_MODIFY_OTHER_KEYS = "\x1B[>4;2m";
export const DISABLE_MODIFY_OTHER_KEYS = "\x1B[>4m";
export const ENABLE_KITTY_KEYBOARD = "\x1B[>1u";
export const DISABLE_KITTY_KEYBOARD = "\x1B[<u";
export const ENABLE_SGR_WHEEL_MOUSE = "\x1B[?1000h\x1B[?1006h";
export const ENABLE_SGR_MOUSE = "\x1B[?1000h\x1B[?1002h\x1B[?1003h\x1B[?1006h";
export const DISABLE_SGR_MOUSE = "\x1B[?1006l\x1B[?1003l\x1B[?1002l\x1B[?1000l";
export const ENABLE_ALTERNATE_SCROLL = "\x1B[?1007h";
export const DISABLE_ALTERNATE_SCROLL = "\x1B[?1007l";
export const ENABLE_FOCUS_EVENTS = "\x1B[?1004h";
export const DISABLE_FOCUS_EVENTS = "\x1B[?1004l";
export const ENABLE_BRACKETED_PASTE = "\x1B[?2004h";
export const DISABLE_BRACKETED_PASTE = "\x1B[?2004l";

export type TerminalInteractionModes = {
  kittyKeyboard: boolean;
  modifyOtherKeys: boolean;
  mouseTracking: boolean;
  wheelMouseTracking?: boolean;
  alternateScroll?: boolean;
  focusEvents: boolean;
  bracketedPaste: boolean;
};

export function enableTerminalInteractionModes(
  stdout: Writable | undefined,
  modes: TerminalInteractionModes,
): void {
  if (modes.kittyKeyboard) writeBestEffort(stdout, ENABLE_KITTY_KEYBOARD);
  if (modes.modifyOtherKeys) writeBestEffort(stdout, ENABLE_MODIFY_OTHER_KEYS);
  if (modes.alternateScroll) writeBestEffort(stdout, ENABLE_ALTERNATE_SCROLL);
  if (modes.mouseTracking) {
    writeBestEffort(stdout, modes.wheelMouseTracking ? ENABLE_SGR_WHEEL_MOUSE : ENABLE_SGR_MOUSE);
  }
  if (modes.focusEvents) writeBestEffort(stdout, ENABLE_FOCUS_EVENTS);
  if (modes.bracketedPaste) writeBestEffort(stdout, ENABLE_BRACKETED_PASTE);
}

export function disableTerminalInteractionModes(
  stdout: Writable | undefined,
  modes: TerminalInteractionModes,
): void {
  if (modes.bracketedPaste) writeBestEffort(stdout, DISABLE_BRACKETED_PASTE);
  if (modes.focusEvents) writeBestEffort(stdout, DISABLE_FOCUS_EVENTS);
  if (modes.mouseTracking) writeBestEffort(stdout, DISABLE_SGR_MOUSE);
  if (modes.alternateScroll) writeBestEffort(stdout, DISABLE_ALTERNATE_SCROLL);
  if (modes.modifyOtherKeys) writeBestEffort(stdout, DISABLE_MODIFY_OTHER_KEYS);
  if (modes.kittyKeyboard) writeBestEffort(stdout, DISABLE_KITTY_KEYBOARD);
}

export type TerminalInteractionSession = {
  enable: () => void;
  disable: () => void;
  reassert: () => void;
};

export type TerminalInteractionSignalTarget = {
  platform?: string;
  pid?: number;
  on?: (event: string, listener: () => void) => unknown;
  off?: (event: string, listener: () => void) => unknown;
  kill?: (pid: number, signal: string) => unknown;
};

export type TerminalInteractionSignalBinding = {
  dispose: () => void;
  suspend: () => void;
  resume: () => void;
};

export function createTerminalInteractionSession(
  stdout: Writable | undefined,
  modes: TerminalInteractionModes,
): TerminalInteractionSession {
  let enabled = false;
  return {
    enable: () => {
      enableTerminalInteractionModes(stdout, modes);
      enabled = true;
    },
    disable: () => {
      if (!enabled) return;
      disableTerminalInteractionModes(stdout, modes);
      enabled = false;
    },
    reassert: () => {
      if (!enabled) return;
      reassertTerminalInteractionModes(stdout, modes);
    },
  };
}

export function bindTerminalInteractionSignals(
  target: TerminalInteractionSignalTarget,
  session: TerminalInteractionSession,
): TerminalInteractionSignalBinding {
  let listeningForSuspend = false;
  const listenForSuspend = () => {
    if (target.platform === "win32" || listeningForSuspend) return;
    target.on?.("SIGTSTP", suspend);
    listeningForSuspend = true;
  };
  const stopListeningForSuspend = () => {
    if (!listeningForSuspend) return;
    target.off?.("SIGTSTP", suspend);
    listeningForSuspend = false;
  };
  const suspend = () => {
    session.disable();
    stopListeningForSuspend();
    if (typeof target.pid === "number") target.kill?.(target.pid, "SIGTSTP");
  };
  const resume = () => {
    session.enable();
    listenForSuspend();
  };

  listenForSuspend();
  target.on?.("SIGCONT", resume);
  return {
    dispose: () => {
      stopListeningForSuspend();
      target.off?.("SIGCONT", resume);
    },
    suspend,
    resume,
  };
}

export function reassertTerminalInteractionModes(
  stdout: Writable | undefined,
  modes: TerminalInteractionModes,
): void {
  enableTerminalInteractionModes(stdout, modes);
}

export function writeBestEffort(stdout: Writable | undefined, text: string): void {
  try {
    stdout?.write(text);
  } catch {
    // stdout may already be closed during terminal teardown.
  }
}
