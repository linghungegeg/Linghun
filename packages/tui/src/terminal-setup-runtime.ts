/**
 * /terminal-setup command runtime.
 * Detects the current terminal environment and outputs keybinding configuration guidance.
 * Pure runtime module — no React/Ink dependencies.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type TerminalEnvironment = {
  terminal: string; // "windows-terminal" | "vscode" | "iterm2" | "gnome-terminal" | "unknown"
  shell: string; // "powershell" | "pwsh" | "bash" | "zsh" | "fish" | "cmd" | "unknown"
  os: "windows" | "macos" | "linux";
  supportsUnicode: boolean;
  supports256Color: boolean;
  supportsTrueColor: boolean;
  supportsBracketedPaste: boolean;
  supportsMouseEvents: boolean;
};

export type SetupRecommendation = {
  category: "keybinding" | "font" | "color" | "general";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
};

export type ConfigSnippet = {
  target: string; // e.g. "Windows Terminal settings.json", ".zshrc"
  content: string; // the actual config snippet
  instruction: string; // where to put it
};

export type SetupGuidance = {
  environment: TerminalEnvironment;
  recommendations: SetupRecommendation[];
  configSnippets: ConfigSnippet[];
};

// ─── Detection ───────────────────────────────────────────────────────────────

function detectOS(): "windows" | "macos" | "linux" {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    default:
      return "linux";
  }
}

function detectTerminal(): string {
  const env = process.env;

  if (env.WT_SESSION) return "windows-terminal";

  const termProgram = (env.TERM_PROGRAM ?? "").toLowerCase();
  if (termProgram === "vscode") return "vscode";
  if (termProgram === "iterm.app") return "iterm2";

  if (env.GNOME_TERMINAL_SERVICE) return "gnome-terminal";

  // Fallback heuristics
  if (env.TERMINAL_EMULATOR?.includes("JetBrains")) return "jetbrains";
  if (env.KITTY_WINDOW_ID) return "kitty";
  if (env.ALACRITTY_LOG) return "alacritty";

  return "unknown";
}

function detectShell(): string {
  const env = process.env;

  // PowerShell detection (works on all platforms)
  if (env.POWERSHELL_DISTRIBUTION_CHANNEL) return "pwsh";
  if (env.PSModulePath) {
    // Distinguish Windows PowerShell from pwsh
    if (env.PSModulePath.includes("PowerShell\\7")) return "pwsh";
    return "powershell";
  }

  // Unix SHELL env
  const shell = env.SHELL ?? "";
  if (shell.endsWith("/zsh") || shell.endsWith("/zsh.exe")) return "zsh";
  if (shell.endsWith("/bash") || shell.endsWith("/bash.exe")) return "bash";
  if (shell.endsWith("/fish") || shell.endsWith("/fish.exe")) return "fish";

  // Windows cmd fallback
  if (env.ComSpec && !env.SHELL && detectOS() === "windows") return "cmd";

  return "unknown";
}

function detectColorSupport(): { supports256: boolean; trueColor: boolean } {
  const env = process.env;
  const colorTerm = (env.COLORTERM ?? "").toLowerCase();
  const term = (env.TERM ?? "").toLowerCase();

  const trueColor =
    colorTerm === "truecolor" ||
    colorTerm === "24bit" ||
    term.includes("24bit") ||
    term.includes("direct");

  const supports256 =
    trueColor ||
    term.includes("256color") ||
    colorTerm === "yes" ||
    !!env.WT_SESSION;

  return { supports256, trueColor };
}

function detectUnicodeSupport(
  terminal: string,
  os: "windows" | "macos" | "linux",
): boolean {
  // Modern terminals generally support unicode
  if (
    terminal === "windows-terminal" ||
    terminal === "vscode" ||
    terminal === "iterm2" ||
    terminal === "kitty" ||
    terminal === "alacritty"
  ) {
    return true;
  }
  if (os === "macos") return true;

  // Check locale on Linux
  const lang = (process.env.LANG ?? "").toLowerCase();
  if (lang.includes("utf-8") || lang.includes("utf8")) return true;

  // Windows conhost without WT_SESSION may not support unicode well
  if (os === "windows" && terminal === "unknown") return false;

  return true;
}

export function detectTerminalEnvironment(): TerminalEnvironment {
  const os = detectOS();
  const terminal = detectTerminal();
  const shell = detectShell();
  const { supports256, trueColor } = detectColorSupport();
  const supportsUnicode = detectUnicodeSupport(terminal, os);

  // Bracketed paste: most modern terminals support it
  const supportsBracketedPaste =
    terminal !== "unknown" || os !== "windows";

  // Mouse events: supported by most terminal emulators
  const supportsMouseEvents =
    terminal === "windows-terminal" ||
    terminal === "iterm2" ||
    terminal === "kitty" ||
    terminal === "alacritty" ||
    terminal === "gnome-terminal" ||
    terminal === "vscode";

  return {
    terminal,
    shell,
    os,
    supportsUnicode,
    supports256Color: supports256,
    supportsTrueColor: trueColor,
    supportsBracketedPaste,
    supportsMouseEvents,
  };
}

// ─── Guidance Generation ─────────────────────────────────────────────────────

function buildKeybindingRecommendations(
  env: TerminalEnvironment,
): SetupRecommendation[] {
  const recs: SetupRecommendation[] = [];

  if (env.terminal === "windows-terminal") {
    recs.push({
      category: "keybinding",
      title: "Unbind Ctrl+C from copy in Windows Terminal",
      description:
        "Windows Terminal binds Ctrl+C to copy by default, which interferes with SIGINT. " +
        "Use Ctrl+Shift+C for copy and free Ctrl+C for process interruption.",
      priority: "high",
    });
    recs.push({
      category: "keybinding",
      title: "Add Ctrl+Shift+V for paste",
      description:
        "Bind Ctrl+Shift+V to paste so Ctrl+V remains available for terminal apps.",
      priority: "medium",
    });
  }

  if (env.terminal === "vscode") {
    recs.push({
      category: "keybinding",
      title: "Override Ctrl+R in VS Code terminal",
      description:
        "VS Code captures Ctrl+R for recent files. Add a keybinding override to " +
        "pass Ctrl+R through to the terminal for shell reverse-search.",
      priority: "high",
    });
    recs.push({
      category: "keybinding",
      title: "Override Ctrl+G in VS Code terminal",
      description:
        "VS Code captures Ctrl+G for go-to-line. Override it to pass through " +
        "when the terminal panel is focused.",
      priority: "medium",
    });
  }

  return recs;
}

function buildFontRecommendations(
  env: TerminalEnvironment,
): SetupRecommendation[] {
  const recs: SetupRecommendation[] = [];

  recs.push({
    category: "font",
    title: "Use a CJK-compatible monospace font",
    description:
      "For optimal CJK character rendering, use Noto Sans Mono CJK, " +
      "Cascadia Code, or Sarasa Mono as your terminal font. " +
      "These fonts provide correct glyph widths for Chinese/Japanese/Korean characters.",
    priority: "medium",
  });

  if (!env.supportsUnicode) {
    recs.push({
      category: "font",
      title: "Enable Unicode support",
      description:
        "Your terminal may not fully support Unicode/emoji rendering. " +
        "Consider switching to Windows Terminal or setting your locale to UTF-8.",
      priority: "high",
    });
  }

  return recs;
}

function buildColorRecommendations(
  env: TerminalEnvironment,
): SetupRecommendation[] {
  const recs: SetupRecommendation[] = [];

  if (!env.supportsTrueColor) {
    recs.push({
      category: "color",
      title: "Enable true color support",
      description:
        "Your terminal does not advertise true color (24-bit) support. " +
        "Set COLORTERM=truecolor in your shell profile if your terminal supports it.",
      priority: "low",
    });
  }

  return recs;
}

function buildGeneralRecommendations(
  env: TerminalEnvironment,
): SetupRecommendation[] {
  const recs: SetupRecommendation[] = [];

  if (env.os === "windows" && env.terminal === "unknown") {
    recs.push({
      category: "general",
      title: "Upgrade to Windows Terminal",
      description:
        "The legacy Windows console (conhost) has limited Unicode, color, and input support. " +
        "Windows Terminal provides a much better experience for Linghun.",
      priority: "high",
    });
  }

  if (env.shell === "cmd") {
    recs.push({
      category: "general",
      title: "Consider using PowerShell or pwsh",
      description:
        "cmd.exe has limited scripting and environment support. " +
        "PowerShell 7+ (pwsh) offers better integration with modern tools.",
      priority: "medium",
    });
  }

  return recs;
}

function buildConfigSnippets(env: TerminalEnvironment): ConfigSnippet[] {
  const snippets: ConfigSnippet[] = [];

  if (env.terminal === "windows-terminal") {
    snippets.push({
      target: "Windows Terminal settings.json",
      content: JSON.stringify(
        {
          actions: [
            {
              command: { action: "copy", singleLine: false },
              keys: "ctrl+shift+c",
            },
            { command: "paste", keys: "ctrl+shift+v" },
            { command: "unbound", keys: "ctrl+c" },
            { command: "unbound", keys: "ctrl+v" },
          ],
        },
        null,
        2,
      ),
      instruction:
        'Open Settings (Ctrl+,) → Open JSON file. Merge the "actions" array into your existing config.',
    });
  }

  if (env.terminal === "vscode") {
    snippets.push({
      target: "VS Code keybindings.json",
      content: JSON.stringify(
        [
          {
            key: "ctrl+r",
            command: "workbench.action.terminal.sendSequence",
            args: { text: "" },
            when: "terminalFocus",
          },
          {
            key: "ctrl+g",
            command: "workbench.action.terminal.sendSequence",
            args: { text: "" },
            when: "terminalFocus",
          },
        ],
        null,
        2,
      ),
      instruction:
        "Open Command Palette → Preferences: Open Keyboard Shortcuts (JSON). " +
        "Add these entries to the array.",
    });
  }

  // Shell profile snippets for truecolor
  if (!env.supportsTrueColor) {
    if (env.shell === "zsh") {
      snippets.push({
        target: "~/.zshrc",
        content: 'export COLORTERM="truecolor"',
        instruction: "Add this line to the end of your ~/.zshrc file.",
      });
    } else if (env.shell === "bash") {
      snippets.push({
        target: "~/.bashrc",
        content: 'export COLORTERM="truecolor"',
        instruction: "Add this line to the end of your ~/.bashrc file.",
      });
    } else if (env.shell === "fish") {
      snippets.push({
        target: "~/.config/fish/config.fish",
        content: "set -gx COLORTERM truecolor",
        instruction:
          "Add this line to your ~/.config/fish/config.fish file.",
      });
    } else if (
      env.shell === "powershell" ||
      env.shell === "pwsh"
    ) {
      snippets.push({
        target: "$PROFILE (PowerShell profile)",
        content: '$env:COLORTERM = "truecolor"',
        instruction:
          "Add this line to your PowerShell profile. Run $PROFILE to find the path.",
      });
    }
  }

  // Unicode locale snippet for Linux without UTF-8
  if (env.os === "linux" && !env.supportsUnicode) {
    snippets.push({
      target: "~/.bashrc or ~/.zshrc",
      content:
        'export LANG="en_US.UTF-8"\nexport LC_ALL="en_US.UTF-8"',
      instruction:
        "Add these lines to your shell profile to enable UTF-8 locale.",
    });
  }

  return snippets;
}

export function generateSetupGuidance(env: TerminalEnvironment): SetupGuidance {
  const recommendations = [
    ...buildKeybindingRecommendations(env),
    ...buildFontRecommendations(env),
    ...buildColorRecommendations(env),
    ...buildGeneralRecommendations(env),
  ];

  const configSnippets = buildConfigSnippets(env);

  return {
    environment: env,
    recommendations,
    configSnippets,
  };
}
