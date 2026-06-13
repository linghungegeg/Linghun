// bash-subcommand-parser.ts — R7 Task 1
//
// Decomposes compound Bash commands (pipe chains, && / || / ; sequences)
// into individual segments for per-segment classification. Allows safe
// pipe chains like `ls | grep foo` to auto-allow while still catching
// `ls && rm -rf /` as require_permission.
//
// Pure functions — no I/O, no side effects.

import {
  classifyBashHead,
  tokenizeShellCommand,
  type SemanticClass,
} from "./permission-policy-engine.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SubcommandSegment = {
  command: string;
  operator: "|" | "&&" | "||" | ";" | null;
  index: number;
};

export type ClassifiedSegment = {
  segment: SubcommandSegment;
  headToken: string;
  semanticClass: string;
  decision: "auto_allow_readonly" | "require_permission";
};

export type CompoundClassification = {
  segments: ClassifiedSegment[];
  aggregateDecision: "auto_allow_readonly" | "require_permission";
  riskySummary?: string;
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Split a compound shell command into segments separated by |, &&, ||, ;
 * Respects quoting (single, double, backtick) and $(...) nesting so that
 * operators inside strings or subshells are not treated as separators.
 *
 * Redirect operators (>, >>, <, 2>, 2>>) are NOT separators — they remain
 * part of the command segment they belong to.
 */
export function parseCompoundCommand(command: string): SubcommandSegment[] {
  const segments: SubcommandSegment[] = [];
  let current = "";
  let quote: '"' | "'" | "`" | null = null;
  let parenDepth = 0; // tracks $(...) nesting
  let i = 0;

  function pushSegment(operator: SubcommandSegment["operator"]): void {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      segments.push({ command: trimmed, operator, index: segments.length });
    }
    current = "";
  }

  while (i < command.length) {
    const ch = command[i]!;

    // Handle escape sequences outside single quotes
    if (ch === "\\" && quote !== "'" && i + 1 < command.length) {
      current += ch + command[i + 1]!;
      i += 2;
      continue;
    }

    // Inside quotes — consume until matching close
    if (quote) {
      current += ch;
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    // Enter quotes
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      i += 1;
      continue;
    }

    // $( — enter subshell
    if (ch === "$" && command[i + 1] === "(") {
      parenDepth += 1;
      current += "$(";
      i += 2;
      continue;
    }

    // ) — exit subshell if inside one
    if (ch === ")" && parenDepth > 0) {
      parenDepth -= 1;
      current += ch;
      i += 1;
      continue;
    }

    // Inside a subshell — don't split
    if (parenDepth > 0) {
      current += ch;
      i += 1;
      continue;
    }

    // Detect operators: &&, ||, ;, |
    // Must distinguish | from || and & (part of &&) from bare &
    if (ch === "&" && command[i + 1] === "&") {
      pushSegment("&&");
      i += 2;
      continue;
    }
    if (ch === "|" && command[i + 1] === "|") {
      pushSegment("||");
      i += 2;
      continue;
    }
    if (ch === "|") {
      pushSegment("|");
      i += 1;
      continue;
    }
    if (ch === ";") {
      pushSegment(";");
      i += 1;
      continue;
    }

    // Redirect operators are NOT separators — keep them in current segment
    // >, >>, <, 2>, 2>> — just consume as part of the command
    current += ch;
    i += 1;
  }

  // Final segment (no trailing operator)
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    segments.push({ command: trimmed, operator: null, index: segments.length });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Detect whether a segment's *unquoted* text contains an output redirect.
 * Strips single/double-quoted regions first so that `echo "a > b"` is not
 * a false positive. Matches >, >>, 2>, 2>> outside quotes.
 */
function hasOutputRedirect(segment: string): boolean {
  // Strip quoted regions (both ' and ")
  let stripped = "";
  let quote: string | null = null;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;
    if (ch === "\\" && quote !== "'" && i + 1 < segment.length) {
      if (!quote) stripped += ch + segment[i + 1]!;
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    stripped += ch;
  }
  // Now test for output redirect in the stripped (unquoted) text.
  // Match > or >> optionally preceded by a digit (fd redirect), but not
  // preceded by < (which would be <<, a heredoc/input construct).
  return /(?<![<])\d*>/u.test(stripped);
}

/**
 * Classify a compound command by decomposing it and classifying each segment.
 *
 * @param command  Raw shell command string (may contain |, &&, ||, ;)
 * @param _workspacePath  Workspace root (reserved for future path checks)
 * @returns Aggregate classification with per-segment details
 */
export function classifyCompoundCommand(
  command: string,
  _workspacePath: string,
): CompoundClassification {
  const parsed = parseCompoundCommand(command);

  if (parsed.length === 0) {
    return {
      segments: [],
      aggregateDecision: "require_permission",
      riskySummary: "empty command",
    };
  }

  const classified: ClassifiedSegment[] = [];
  let aggregateDecision: CompoundClassification["aggregateDecision"] = "auto_allow_readonly";
  let riskySummary: string | undefined;

  for (const seg of parsed) {
    const tokens = tokenizeShellCommand(seg.command);
    const head = (tokens[0] ?? "").toLowerCase();
    const args = tokens.slice(1);

    // Determine semantic class from head token
    let semanticClass: SemanticClass;
    if (head.length === 0) {
      semanticClass = "unknown";
    } else {
      semanticClass = classifyBashHead(head, args);
    }

    // Redirect operators in the segment override to at least mutating
    if (semanticClass === "readonly" && hasOutputRedirect(seg.command)) {
      semanticClass = "mutating";
    }

    const decision: ClassifiedSegment["decision"] =
      semanticClass === "readonly" ? "auto_allow_readonly" : "require_permission";

    classified.push({
      segment: seg,
      headToken: head,
      semanticClass,
      decision,
    });

    if (decision === "require_permission" && aggregateDecision === "auto_allow_readonly") {
      aggregateDecision = "require_permission";
      riskySummary = `segment ${seg.index}: ${head || "<empty>"} is ${semanticClass}`;
    }
  }

  return {
    segments: classified,
    aggregateDecision,
    riskySummary,
  };
}
