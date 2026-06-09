export type SlashCandidate = {
  slash: string;
  description: string;
};

/**
 * Compute ghost text to display after the cursor.
 * Returns the suffix to show dimmed (e.g., if input is "/he" and match is "/help", returns "lp").
 * Returns undefined if no single unambiguous match exists.
 */
export function computeGhostText(
  input: string,
  candidates: SlashCandidate[],
): string | undefined {
  if (!input || !input.startsWith("/")) return undefined;
  if (input.includes(" ")) return undefined;

  const matches = candidates.filter((c) => c.slash.startsWith(input));
  if (matches.length !== 1) return undefined;

  const suffix = matches[0].slash.slice(input.length);
  return suffix.length > 0 ? suffix : undefined;
}

/**
 * Apply ghost text: returns the full text after Tab-accepting the ghost.
 * Appends a trailing space for UX (ready to type args).
 */
export function acceptGhostText(input: string, ghost: string): string {
  return input + ghost + " ";
}
