/**
 * Hyperlink utilities for creating clickable terminal links
 * Based on CCB's hyperlink implementation
 */

// OSC 8 hyperlink escape sequences
// Format: \e]8;;URL\e\\TEXT\e]8;;\e\\
// Using \x07 (BEL) as terminator which is more widely supported
const OSC8_START = "\x1b]8;;";
const OSC8_END = "\x07";

/**
 * Check if terminal supports hyperlinks
 * Based on common terminal emulator detection
 */
function supportsHyperlinks(): boolean {
  // Check environment variables for known hyperlink-capable terminals
  const term = process.env.TERM || "";
  const termProgram = process.env.TERM_PROGRAM || "";

  // Known terminals with hyperlink support
  const knownSupported = [
    "iTerm.app",
    "WezTerm",
    "vscode",
    "Hyper",
    "Tabby",
  ];

  if (knownSupported.includes(termProgram)) {
    return true;
  }

  // Windows Terminal supports hyperlinks
  if (process.env.WT_SESSION) {
    return true;
  }

  // VTE-based terminals (GNOME Terminal, etc.)
  if (process.env.VTE_VERSION) {
    return true;
  }

  // Fallback: assume modern terminal if xterm-256color
  return term.includes("256color");
}

/**
 * Create a clickable hyperlink using OSC 8 escape sequences.
 * Falls back to plain text if the terminal doesn't support hyperlinks.
 *
 * @param url - The URL to link to
 * @param content - Optional content to display as the link text
 * @returns Hyperlink string or plain URL
 */
export function createHyperlink(url: string, content?: string): string {
  if (!supportsHyperlinks()) {
    return url;
  }

  const displayText = content ?? url;
  // Apply blue color using ANSI escape code
  const blueColor = "\x1b[34m"; // ANSI blue
  const resetColor = "\x1b[0m"; // ANSI reset
  const coloredText = `${blueColor}${displayText}${resetColor}`;

  return `${OSC8_START}${url}${OSC8_END}${coloredText}${OSC8_START}${OSC8_END}`;
}

/**
 * Match http(s) URLs in text
 * Conservative: no quotes, no whitespace, no trailing comma/brace
 */
const URL_PATTERN = /https?:\/\/[^\s"'<>\\]+/g;

/**
 * Replace URLs in text with clickable hyperlinks
 */
export function linkifyUrlsInText(content: string): string {
  return content.replace(URL_PATTERN, (url) => createHyperlink(url));
}
