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
 * Home brand wordmark. Responsive to terminal width and capability.
 * Legacy terminals always get ASCII-safe rendering regardless of noColor.
 */
export function brandWordmark(
  noColor: boolean,
  width = 80,
  capability?: TerminalCapability,
): string[] {
  const asciiSafe = noColor || (capability ? !capability.unicodeBox : false);

  if (width >= 80) {
    return brandWordmarkLarge(asciiSafe);
  }
  if (width >= 60) {
    return brandWordmarkCompact(asciiSafe);
  }
  return brandWordmarkNarrow();
}

/** Large wordmark for wide terminals (>=80 cols). */
function brandWordmarkLarge(asciiSafe: boolean): string[] {
  if (asciiSafe) {
    return [
      " _     _         _  _",
      "| |   (_)_ __   | || |_   _ _ __",
      "| |   | | '_ \\  | || | | | | '_ \\",
      "| |__ | | | | | | || | |_| | | | |",
      "|____|_|_| |_| |_||_|\\__,_|_| |_|",
      "",
      " LingHun",
    ];
  }
  return [
    "  \u254B   \u254B         \u254B \u254B",
    "  \u2503   \u2503\u257A\u2513\u257A\u2513\u250F\u2501\u2513  \u2503\u2501\u2503\u257B \u257B\u257A\u2513\u257A\u2513",
    "  \u2503   \u2503 \u2503 \u2503\u2503 \u2503  \u2503 \u2503\u2503 \u2503 \u2503 \u2503",
    "  \u2517\u2501\u2501 \u2579 \u2579 \u2579\u2517\u2501\u251B  \u2517\u2501\u251B\u2517\u2501\u251B \u2579 \u2579",
    "",
    "  LingHun",
  ];
}

/** Compact wordmark for medium terminals (60-79 cols). */
function brandWordmarkCompact(asciiSafe: boolean): string[] {
  if (asciiSafe) {
    return ["LingHun", "=============="];
  }
  return [
    "LingHun",
    "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
  ];
}

/** Narrow wordmark for small terminals (<60 cols). */
function brandWordmarkNarrow(): string[] {
  return ["LingHun"];
}
