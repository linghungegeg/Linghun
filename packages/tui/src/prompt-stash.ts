export type PromptStash = {
  text: string | undefined;
};

export function createPromptStash(): PromptStash {
  return { text: undefined };
}

/**
 * Stash or unstash. Returns the new stash state and the text to set in the buffer.
 * - If currentText is non-empty: saves to stash, returns bufferText="" (clear buffer)
 * - If currentText is empty and stash has content: returns bufferText=stash, clears stash
 * - If both empty: no-op, returns undefined bufferText
 */
export function toggleStash(
  stash: PromptStash,
  currentText: string,
): { stash: PromptStash; bufferText: string | undefined } {
  if (currentText.length > 0) {
    return { stash: { text: currentText }, bufferText: '' };
  }
  if (stash.text !== undefined) {
    const restored = stash.text;
    return { stash: { text: undefined }, bufferText: restored };
  }
  return { stash, bufferText: undefined };
}
