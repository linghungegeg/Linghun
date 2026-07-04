export function findStableMarkdownPrefixLength(text: string): number {
  let offset = 0;
  let boundary = 0;
  let inCode = false;
  const table = createStreamingTableHoldbackState();
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/gu)) {
    const segment = match[0];
    if (!segment) break;
    if (!segment.endsWith("\n")) break;
    const line = segment.slice(0, -1);
    const fence = /^\s*```\s*[A-Za-z0-9_+-]*\s*$/u.test(line);
    if (fence) {
      inCode = !inCode;
      if (!inCode) table.reset();
      offset += segment.length;
      boundary = offset;
      continue;
    }
    offset += segment.length;
    if (inCode) {
      boundary = offset;
      continue;
    }
    const tableDecision = table.pushLine(line, offset - segment.length);
    if (tableDecision.kind === "closed") {
      boundary = offset;
      continue;
    }
    if (tableDecision.kind === "active") {
      boundary = Math.min(boundary, tableDecision.start);
      continue;
    }
    if (line.trim().length === 0) boundary = offset;
  }
  if (
    !inCode &&
    text.endsWith("\n") &&
    hasBalancedInlineMarkdown(text) &&
    !table.hasActiveCandidate()
  ) {
    return text.length;
  }
  return boundary;
}

export function findStableMarkdownLinePrefixLength(text: string): number {
  let offset = 0;
  let boundary = 0;
  let inCode = false;
  const table = createStreamingTableHoldbackState();
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/gu)) {
    const segment = match[0];
    if (!segment) break;
    if (!segment.endsWith("\n")) break;
    const line = segment.slice(0, -1);
    const fence = /^\s*```\s*[A-Za-z0-9_+-]*\s*$/u.test(line);
    if (fence) {
      inCode = !inCode;
      if (!inCode) table.reset();
      offset += segment.length;
      boundary = offset;
      continue;
    }
    offset += segment.length;
    if (inCode) {
      boundary = offset;
      continue;
    }
    const tableDecision = table.pushLine(line, offset - segment.length);
    if (tableDecision.kind === "active") {
      boundary = Math.min(boundary, tableDecision.start);
      continue;
    }
    boundary = offset;
  }
  return boundary;
}

type StreamingTableDecision =
  | { kind: "none" }
  | { kind: "active"; start: number }
  | { kind: "closed" };

function createStreamingTableHoldbackState(): {
  pushLine: (line: string, lineStart: number) => StreamingTableDecision;
  hasActiveCandidate: () => boolean;
  reset: () => void;
} {
  let candidateStart: number | undefined;
  let active = false;

  return {
    pushLine(line, lineStart) {
      const trimmed = line.trim();
      if (!trimmed) {
        const wasActive = candidateStart !== undefined || active;
        candidateStart = undefined;
        active = false;
        return wasActive ? { kind: "closed" } : { kind: "none" };
      }

      if (candidateStart === undefined) {
        if (isMarkdownTableRow(trimmed)) {
          candidateStart = lineStart;
          return { kind: "active", start: candidateStart };
        }
        return { kind: "none" };
      }

      if (isMarkdownTableDelimiter(trimmed) || (active && isMarkdownTableRow(trimmed))) {
        active = true;
        return { kind: "active", start: candidateStart };
      }

      if (!active) {
        candidateStart = undefined;
        return { kind: "none" };
      }

      candidateStart = undefined;
      active = false;
      return { kind: "closed" };
    },
    hasActiveCandidate() {
      return candidateStart !== undefined || active;
    },
    reset() {
      candidateStart = undefined;
      active = false;
    },
  };
}

function isMarkdownTableRow(line: string): boolean {
  return line.includes("|") && line.split("|").filter((part) => part.trim()).length >= 2;
}

function isMarkdownTableDelimiter(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = line
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function hasBalancedInlineMarkdown(text: string): boolean {
  let inInlineCode = false;
  let boldOpen = false;
  let italicOpen = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "`") {
      inInlineCode = !inInlineCode;
      continue;
    }
    if (!inInlineCode && char === "*" && text[index + 1] === "*") {
      boldOpen = !boldOpen;
      index += 1;
      continue;
    }
    if (!inInlineCode && char === "*") {
      italicOpen = !italicOpen;
    }
  }
  return !inInlineCode && !boldOpen && !italicOpen;
}
