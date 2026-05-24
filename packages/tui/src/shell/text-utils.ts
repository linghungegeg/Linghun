/** Shared text utilities for shell components and plain renderer. */

export function fitText(value: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(value.replace(/\s+/gu, " ").trim());
  let width = 0;
  let result = "";
  for (const char of chars) {
    const next = width + charWidth(char);
    if (next > max) return `${result}\u2026`;
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

/** Terminal-safe horizontal line character: box-drawing in color mode, ASCII dash in no-color. */
export function lineChar(noColor: boolean): string {
  return noColor ? "-" : "\u2500";
}

/** Home brand wordmark. Keep it ASCII-safe for Windows console resize stability. */
export function brandWordmark(noColor: boolean): string[] {
  if (noColor) {
    return ["LingHun", "--------------"];
  }
  return ["LingHun", "──────────────"];
}
