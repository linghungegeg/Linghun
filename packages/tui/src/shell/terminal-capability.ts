import { release as osRelease } from "node:os";

/**
 * Terminal capability detection for UI rendering decisions.
 *
 * Classifies the current terminal into tiers:
 * - "modern": Windows Terminal, iTerm2, Alacritty, kitty, WezTerm, VS Code terminal, etc.
 *   Supports full Unicode box-drawing, emoji, 256-color/truecolor.
 * - "basic": ConEmu, mintty, xterm without known modern features.
 *   Supports basic Unicode but may have issues with complex box-drawing.
 * - "legacy": Windows cmd.exe (conhost), TERM=dumb, non-TTY.
 *   ASCII-only safe rendering, no box-drawing, no emoji.
 *
 * This module is pure and side-effect-free; it reads environment variables
 * but does not modify terminal state.
 */

export type TerminalTier = "modern" | "basic" | "legacy";

export type TerminalCapability = {
  tier: TerminalTier;
  /** Whether Unicode box-drawing characters render correctly. */
  unicodeBox: boolean;
  /** Whether CJK wide characters are handled correctly. */
  cjkWide: boolean;
  /** Whether 256-color or truecolor is supported. */
  richColor: boolean;
  /** Whether kitty keyboard protocol is available. */
  kittyKeyboard: boolean;
  /** Whether alternate screen buffer is safe to use. */
  alternateScreen: boolean;
  /** Whether the terminal supports cursor positioning reliably. */
  cursorPositioning: boolean;
};

let cachedCapability: TerminalCapability | undefined;

/** Detect terminal capability. Result is cached for the process lifetime. */
export function detectTerminalCapability(): TerminalCapability {
  if (cachedCapability) return cachedCapability;
  cachedCapability = detectTerminalCapabilityUncached();
  return cachedCapability;
}

/** Reset cached capability (for testing). */
export function resetTerminalCapabilityCache(): void {
  cachedCapability = undefined;
}

function detectTerminalCapabilityUncached(): TerminalCapability {
  const env = process.env;

  // Explicit override
  if (env.LINGHUN_TERMINAL_TIER === "legacy") return legacyCapability();
  if (env.LINGHUN_TERMINAL_TIER === "basic") return basicCapability();
  if (env.LINGHUN_TERMINAL_TIER === "modern") return modernCapability();

  // Non-TTY or dumb terminal
  if (env.TERM === "dumb") return legacyCapability();

  // Windows-specific detection
  if (process.platform === "win32") {
    return detectWindowsTerminal(env);
  }

  // Unix-like detection
  return detectUnixTerminal(env);
}

function detectWindowsTerminal(env: NodeJS.ProcessEnv): TerminalCapability {
  // Windows Terminal (modern conpty-based)
  if (env.WT_SESSION) return modernCapability();

  // VS Code integrated terminal
  if (env.TERM_PROGRAM === "vscode") return modernCapability();

  // WezTerm
  if (env.TERM_PROGRAM === "WezTerm") return modernCapability();

  // Alacritty on Windows
  if (env.TERM_PROGRAM === "alacritty" || env.ALACRITTY_WINDOW_ID) return modernCapability();

  // ConEmu / Cmder
  if (env.ConEmuPID || env.CONEMUDIR) return basicCapability();

  // mintty (Git Bash, MSYS2)
  if (env.TERM_PROGRAM === "mintty" || env.MSYSTEM) return basicCapability();

  // TERM is set and not "dumb" — some capable terminal emulator is wrapping
  if (env.TERM && env.TERM !== "dumb") return basicCapability();

  // Windows 10 1809+ (build 17763+) ships conpty which supports cursor positioning.
  // cmd.exe and PowerShell on modern Windows can run Ink safely.
  // Only truly ancient conhost (pre-1809) lacks VT support — extremely rare today.
  if (isWindows10ConptyCapable()) return basicCapability();

  // True legacy: pre-1809 conhost with no VT support
  return legacyCapability();
}

/** Windows 10 build 17763+ has conpty with VT sequence support. */
function isWindows10ConptyCapable(): boolean {
  try {
    const ver = process.platform === "win32" ? osRelease() : "";
    const parts = ver.split(".");
    const major = Number.parseInt(parts[0] ?? "0", 10);
    const build = Number.parseInt(parts[2] ?? "0", 10);
    // Windows 10 (major=10) build 17763+ has conpty
    return major >= 10 && build >= 17763;
  } catch {
    return false;
  }
}

function detectUnixTerminal(env: NodeJS.ProcessEnv): TerminalCapability {
  const termProgram = env.TERM_PROGRAM ?? "";

  // Known modern terminals
  if (termProgram === "iTerm.app") return modernCapability();
  if (termProgram === "WezTerm") return modernCapability();
  if (termProgram === "alacritty" || env.ALACRITTY_WINDOW_ID) return modernCapability();
  if (termProgram === "kitty" || env.KITTY_WINDOW_ID) {
    return { ...modernCapability(), kittyKeyboard: true };
  }
  if (termProgram === "vscode") return modernCapability();
  if (termProgram === "ghostty") return modernCapability();
  if (termProgram === "rio") return modernCapability();

  // tmux/screen — generally modern enough
  if (env.TMUX || env.TERM?.startsWith("screen")) return basicCapability();

  // xterm-256color or similar
  if (env.TERM?.includes("256color") || env.COLORTERM === "truecolor") {
    return modernCapability();
  }

  // Generic xterm
  if (env.TERM?.startsWith("xterm")) return basicCapability();

  // Unknown — assume basic
  return basicCapability();
}

function modernCapability(): TerminalCapability {
  return {
    tier: "modern",
    unicodeBox: true,
    cjkWide: true,
    richColor: true,
    kittyKeyboard: false,
    alternateScreen: true,
    cursorPositioning: true,
  };
}

function basicCapability(): TerminalCapability {
  return {
    tier: "basic",
    unicodeBox: true,
    cjkWide: true,
    richColor: true,
    kittyKeyboard: false,
    alternateScreen: true,
    cursorPositioning: true,
  };
}

function legacyCapability(): TerminalCapability {
  return {
    tier: "legacy",
    unicodeBox: false,
    cjkWide: false,
    richColor: false,
    kittyKeyboard: false,
    alternateScreen: false,
    cursorPositioning: false,
  };
}
