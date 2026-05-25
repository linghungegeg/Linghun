/** Shared text utilities for shell components and plain renderer. */

import type { TerminalCapability } from "./terminal-capability.js";

export function fitText(value: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(value.replace(/\s+/gu, " ").trim());
  let width = 0;
  let result = "";
  for (const char of chars) {
    const next = width + charWidth(char);
    if (next > max) return `${result}...`;
    result += char;
    width = next;
  }
  return result;
}

export function charWidth(char: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(
    char,
  )
    ? 2
    : 1;
}

/** Shared composer width formula, kept consistent across Ink and plain renderer. */
export function composerMaxWidth(viewWidth: number): number {
  return Math.min(80, Math.max(40, viewWidth - 6));
}

/**
 * Terminal-safe horizontal line character.
 * Legacy terminals get ASCII dash; modern/basic get box-drawing.
 */
export function lineChar(noColor: boolean, capability?: TerminalCapability): string {
  if (noColor) return "-";
  if (capability && !capability.unicodeBox) return "-";
  return "\u2500";
}

/**
 * Home brand wordmark.
 *
 * Foundation rule (D13D): the wordmark is a single, deterministic line
 * "LingHun" at every width and capability tier. ASCII art / Unicode
 * box-drawing wordmarks were intentionally removed — they break alignment
 * across terminals (CJK widths, mintty, conhost), introduce empty-string
 * spacer lines for vertical padding, and inflate the home view above the
 * fold. No version number is appended; no empty strings are used as
 * spacers (callers control vertical spacing via Box marginTop).
 */
export function brandWordmark(
  noColor: boolean,
  width = 80,
  capability?: TerminalCapability,
): string[] {
  void noColor;
  void width;
  void capability;
  return ["LingHun"];
}
