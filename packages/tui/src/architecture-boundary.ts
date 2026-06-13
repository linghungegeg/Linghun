/**
 * architecture-boundary.ts — Architecture Boundary Guard
 *
 * Detects and marks architecture boundary risks:
 * - Large files (line count threshold)
 * - Large functions (line count threshold)
 * - Circular dependency risk (cross-layer imports)
 * - Code blob markers (god files, deep nesting)
 * - Cross-layer import warnings
 *
 * Does NOT perform automatic refactoring. Marks risks for reporting and
 * provides a conservative edit preflight helper for existing large files.
 * Does NOT modify any files. Pure classification and detection.
 *
 * D.14A Global Architecture Guard — Anti-Hallucination Runtime Enhancement.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Severity of an architecture boundary violation.
 */
export type BoundaryViolationSeverity = "info" | "warning" | "critical";

/**
 * Kind of architecture boundary violation detected.
 */
export type BoundaryViolationKind =
  | "large-file"
  | "large-function"
  | "deep-nesting"
  | "circular-dependency-risk"
  | "cross-layer-import"
  | "god-file"
  | "code-blob";

/**
 * A single architecture boundary violation.
 */
export type BoundaryViolation = {
  kind: BoundaryViolationKind;
  severity: BoundaryViolationSeverity;
  file: string;
  detail: string;
  metric?: number;
  threshold?: number;
  suggestion: string;
};

/**
 * Result of scanning a file or set of files for boundary violations.
 */
export type BoundaryCheckResult = {
  violations: BoundaryViolation[];
  hasBlocking: boolean;
  hasCritical: boolean;
  summary: string;
};

/**
 * Input for checking a single file's architecture boundaries.
 */
export type FileMetrics = {
  path: string;
  lineCount: number;
  exportCount?: number;
  importSources?: string[];
  functionLengths?: Array<{ name: string; lines: number }>;
  maxNestingDepth?: number;
};

/**
 * Configuration thresholds for boundary detection.
 */
export type BoundaryThresholds = {
  maxFileLines: number;
  maxFunctionLines: number;
  maxNestingDepth: number;
  maxExportsForGodFile: number;
  godFileLineThreshold: number;
};

/**
 * Change declaration for architecture guard validation.
 */
export type ChangeDeclaration = {
  files: string[];
  mainPath: string;
  fallbackPath?: string;
  verificationLevel: string;
  realSmokeRequired: string[];
};

export type BoundaryEditPreflightInput = {
  toolName: "Write" | "Edit" | "MultiEdit" | "Bash";
  path: string;
  existingSource?: string;
  targetExists: boolean;
  input: unknown;
  reportArtifact?: boolean;
};

export type BoundaryEditPreflightResult =
  | { decision: "allow"; reason: string }
  | {
      decision: "confirm";
      reason: string;
      path: string;
      lineCount: number;
      threshold: number;
      estimatedAddedLines: number;
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_THRESHOLDS: BoundaryThresholds = {
  maxFileLines: 800,
  maxFunctionLines: 200,
  maxNestingDepth: 4,
  maxExportsForGodFile: 40,
  godFileLineThreshold: 1500,
};

const SUBSTANTIAL_ADDED_LINES = 40;
const MULTI_EDIT_SUBSTANTIAL_COUNT = 3;

const BASH_FILE_WRITE_PATTERN =
  /(?:^|\s|[;&|]\s*)(>>?|tee(?:\s+-a)?)\s+(\S+)|cat\s+<<\s*\S+\s*>>?\s*(\S+)/giu;

/**
 * Conservative detection of Bash commands that write to workspace files.
 * Only catches clear redirect / tee / heredoc patterns. Does not attempt
 * to fully parse Bash; complex pipes, variable indirection, and encrypted
 * or encoded payloads are not guaranteed to be caught.
 */
export function detectBashFileWriteTargets(command: string): string[] {
  const targets: string[] = [];
  const cleaned = command.replace(/^```(?:bash|sh|shell)?\s*/iu, "").replace(/```\s*$/u, "");
  const regex = BASH_FILE_WRITE_PATTERN;
  for (const match of cleaned.matchAll(regex)) {
    const target = (match[2] ?? match[3] ?? "").replace(/^["']|["']$/gu, "");
    if (
      target &&
      !target.startsWith("/dev/") &&
      !target.startsWith("$") &&
      !target.startsWith("~")
    ) {
      targets.push(target);
    }
  }
  return targets;
}

/**
 * Layer ordering for cross-layer import detection.
 * Lower layers should not import from higher layers.
 */
const LAYER_ORDER: Record<string, number> = {
  shared: 0,
  config: 1,
  core: 2,
  providers: 3,
  tools: 4,
  tui: 5,
  cli: 6,
};

// ---------------------------------------------------------------------------
// File-level boundary checks
// ---------------------------------------------------------------------------

/**
 * Check a single file's metrics against architecture boundaries.
 */
export function checkFileBoundaries(
  metrics: FileMetrics,
  thresholds: BoundaryThresholds = DEFAULT_THRESHOLDS,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];

  // Large file check
  if (metrics.lineCount > thresholds.maxFileLines) {
    const severity: BoundaryViolationSeverity =
      metrics.lineCount > thresholds.godFileLineThreshold ? "critical" : "warning";
    violations.push({
      kind: metrics.lineCount > thresholds.godFileLineThreshold ? "god-file" : "large-file",
      severity,
      file: metrics.path,
      detail: `${metrics.lineCount} lines (threshold: ${thresholds.maxFileLines})`,
      metric: metrics.lineCount,
      threshold: thresholds.maxFileLines,
      suggestion:
        severity === "critical"
          ? "Mark for staged extraction in a future phase; do not expand further."
          : "Avoid adding more logic to this file; prefer adjacent modules.",
    });
  }

  // Large function check
  if (metrics.functionLengths) {
    for (const fn of metrics.functionLengths) {
      if (fn.lines > thresholds.maxFunctionLines) {
        violations.push({
          kind: "large-function",
          severity: fn.lines > thresholds.maxFunctionLines * 2 ? "critical" : "warning",
          file: metrics.path,
          detail: `Function "${fn.name}" is ${fn.lines} lines (threshold: ${thresholds.maxFunctionLines})`,
          metric: fn.lines,
          threshold: thresholds.maxFunctionLines,
          suggestion: "Extract sub-logic into focused helpers within the same module.",
        });
      }
    }
  }

  // Deep nesting check
  if (
    metrics.maxNestingDepth !== undefined &&
    metrics.maxNestingDepth > thresholds.maxNestingDepth
  ) {
    violations.push({
      kind: "deep-nesting",
      severity: metrics.maxNestingDepth > thresholds.maxNestingDepth + 2 ? "critical" : "warning",
      file: metrics.path,
      detail: `Max nesting depth: ${metrics.maxNestingDepth} (threshold: ${thresholds.maxNestingDepth})`,
      metric: metrics.maxNestingDepth,
      threshold: thresholds.maxNestingDepth,
      suggestion: "Use early returns, guard clauses, or extract nested logic.",
    });
  }

  // God file check (high export count + large size)
  if (
    metrics.exportCount !== undefined &&
    metrics.exportCount > thresholds.maxExportsForGodFile &&
    metrics.lineCount > thresholds.maxFileLines
  ) {
    // Only add if not already flagged as god-file by line count
    if (!violations.some((v) => v.kind === "god-file")) {
      violations.push({
        kind: "god-file",
        severity: "critical",
        file: metrics.path,
        detail: `${metrics.exportCount} exports + ${metrics.lineCount} lines indicates a god file`,
        metric: metrics.exportCount,
        threshold: thresholds.maxExportsForGodFile,
        suggestion:
          "Mark for staged extraction; do not add new exports without extracting existing ones.",
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Cross-layer import detection
// ---------------------------------------------------------------------------

/**
 * Detect cross-layer import violations.
 * Lower layers should not import from higher layers.
 */
export function detectCrossLayerImports(
  filePath: string,
  importSources: string[],
): BoundaryViolation[] {
  const fileLayer = inferLayer(filePath);
  if (fileLayer === undefined) return [];

  const violations: BoundaryViolation[] = [];

  for (const source of importSources) {
    const sourceLayer = inferLayerFromImport(source);
    if (sourceLayer === undefined) continue;

    const fileOrder = LAYER_ORDER[fileLayer];
    const sourceOrder = LAYER_ORDER[sourceLayer];

    if (fileOrder !== undefined && sourceOrder !== undefined && sourceOrder > fileOrder) {
      violations.push({
        kind: "cross-layer-import",
        severity: "warning",
        file: filePath,
        detail: `Layer "${fileLayer}" imports from higher layer "${sourceLayer}" via "${source}"`,
        suggestion: "Move shared logic to a lower layer or use dependency inversion.",
      });
    }
  }

  return violations;
}

/**
 * Detect potential circular dependency risk between two files.
 */
export function detectCircularDependencyRisk(
  fileA: { path: string; importSources: string[] },
  fileB: { path: string; importSources: string[] },
): BoundaryViolation | undefined {
  const aImportsB = fileA.importSources.some((source) =>
    source.includes(extractModuleName(fileB.path)),
  );
  const bImportsA = fileB.importSources.some((source) =>
    source.includes(extractModuleName(fileA.path)),
  );

  if (aImportsB && bImportsA) {
    return {
      kind: "circular-dependency-risk",
      severity: "warning",
      file: `${fileA.path} <-> ${fileB.path}`,
      detail: `Mutual import detected between ${fileA.path} and ${fileB.path}`,
      suggestion: "Extract shared types/logic into a third module to break the cycle.",
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Batch checking
// ---------------------------------------------------------------------------

/**
 * Check multiple files and produce a combined boundary check result.
 */
export function checkBoundaries(
  files: FileMetrics[],
  thresholds: BoundaryThresholds = DEFAULT_THRESHOLDS,
): BoundaryCheckResult {
  const violations: BoundaryViolation[] = [];

  for (const file of files) {
    violations.push(...checkFileBoundaries(file, thresholds));
    if (file.importSources) {
      violations.push(...detectCrossLayerImports(file.path, file.importSources));
    }
  }

  const hasCritical = violations.some((v) => v.severity === "critical");
  const hasBlocking = hasCritical; // Critical violations are blocking

  return {
    violations,
    hasBlocking,
    hasCritical,
    summary: formatBoundaryCheckSummary(violations),
  };
}

/**
 * Validate a change declaration against architecture boundaries.
 * Returns warnings if the declaration is missing required fields.
 */
export function validateChangeDeclaration(declaration: Partial<ChangeDeclaration>): string[] {
  const warnings: string[] = [];

  if (!declaration.files || declaration.files.length === 0) {
    warnings.push("Change declaration missing: files list is empty.");
  }

  if (!declaration.mainPath) {
    warnings.push("Change declaration missing: mainPath not specified.");
  }

  if (!declaration.verificationLevel) {
    warnings.push("Change declaration missing: verificationLevel not specified.");
  }

  if (
    declaration.files &&
    declaration.files.length > 3 &&
    (!declaration.realSmokeRequired || declaration.realSmokeRequired.length === 0)
  ) {
    warnings.push(
      "Large change (>3 files) without realSmokeRequired items. Declare what needs real smoke verification.",
    );
  }

  return warnings;
}

/**
 * Conservative source-level preflight for model Write/Edit/MultiEdit calls.
 * It only asks for confirmation when an existing large/god file would receive
 * clear new logic or a large amount of added lines. New files, reports, small
 * edits, and ordinary wiring stay on the existing permission path.
 */
export function checkBoundaryEditPreflight(
  request: BoundaryEditPreflightInput,
  thresholds: BoundaryThresholds = DEFAULT_THRESHOLDS,
): BoundaryEditPreflightResult {
  if (!request.targetExists || request.reportArtifact) {
    return { decision: "allow", reason: "new file or report artifact" };
  }
  const existingSource = request.existingSource;
  if (existingSource === undefined) {
    return { decision: "allow", reason: "existing content unavailable" };
  }
  const metrics = estimateFileMetrics(request.path, existingSource);
  const isLargeFile =
    metrics.lineCount > thresholds.maxFileLines ||
    metrics.lineCount > thresholds.godFileLineThreshold ||
    ((metrics.exportCount ?? 0) > thresholds.maxExportsForGodFile &&
      metrics.lineCount > thresholds.maxFileLines);
  if (!isLargeFile) {
    return { decision: "allow", reason: "target is below large-file thresholds" };
  }

  if (request.toolName === "Bash") {
    return {
      decision: "confirm",
      reason: "large-file-boundary",
      path: request.path,
      lineCount: metrics.lineCount,
      threshold: thresholds.maxFileLines,
      estimatedAddedLines: 0,
    };
  }

  const estimatedAddedLines = estimateAddedLines(request.toolName, request.input);
  if (!isSubstantialEdit(request.toolName, request.input, estimatedAddedLines)) {
    return { decision: "allow", reason: "small local edit" };
  }

  return {
    decision: "confirm",
    reason: "large-file-boundary",
    path: request.path,
    lineCount: metrics.lineCount,
    threshold: thresholds.maxFileLines,
    estimatedAddedLines,
  };
}

/**
 * Format boundary violations for report output.
 */
export function formatBoundaryViolations(violations: BoundaryViolation[]): string {
  if (violations.length === 0) return "No architecture boundary violations detected.";

  const grouped = new Map<BoundaryViolationKind, BoundaryViolation[]>();
  for (const v of violations) {
    const list = grouped.get(v.kind) ?? [];
    list.push(v);
    grouped.set(v.kind, list);
  }

  const lines: string[] = [`Architecture boundary violations: ${violations.length}`];
  for (const [kind, items] of grouped) {
    lines.push(`  ${kind} (${items.length}):`);
    for (const item of items.slice(0, 5)) {
      lines.push(`    - [${item.severity}] ${item.file}: ${item.detail}`);
    }
    if (items.length > 5) {
      lines.push(`    ... and ${items.length - 5} more`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Code blob detection from source text
// ---------------------------------------------------------------------------

/**
 * Estimate file metrics from source text.
 * Lightweight heuristic — does not require a full AST parser.
 */
export function estimateFileMetrics(path: string, source: string): FileMetrics {
  const lines = source.split(/\r?\n/);
  const lineCount = lines.length;

  // Count exports
  let exportCount = 0;
  for (const line of lines) {
    if (/^\s*export\s+(function|const|let|var|class|type|interface|enum|default)\b/.test(line)) {
      exportCount++;
    }
  }

  // Estimate function lengths (heuristic: function start to next function or end)
  const functionLengths = estimateFunctionLengths(lines);

  // Estimate max nesting depth
  const maxNestingDepth = estimateMaxNesting(lines);

  // Extract import sources
  const importSources: string[] = [];
  for (const line of lines) {
    const match = line.match(/(?:from|import)\s+["']([^"']+)["']/);
    if (match?.[1]) {
      importSources.push(match[1]);
    }
  }

  return {
    path,
    lineCount,
    exportCount,
    importSources,
    functionLengths,
    maxNestingDepth,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function inferLayer(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const match = normalized.match(/packages\/([^/]+)\//);
  if (match?.[1]) return match[1];
  const appMatch = normalized.match(/apps\/([^/]+)\//);
  if (appMatch) return "cli";
  return undefined;
}

function inferLayerFromImport(source: string): string | undefined {
  const match = source.match(/@linghun\/([^/]+)/);
  if (match?.[1]) return match[1];
  return undefined;
}

function extractModuleName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const fileName = parts[parts.length - 1] ?? "";
  return fileName.replace(/\.(ts|tsx|js|jsx)$/, "");
}

function estimateFunctionLengths(lines: string[]): Array<{ name: string; lines: number }> {
  const results: Array<{ name: string; lines: number }> = [];
  const functionStartPattern =
    /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/;

  let currentFunction: { name: string; startLine: number; braceDepth: number } | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!currentFunction) {
      const match = functionStartPattern.exec(line);
      if (match) {
        const name = match[1] ?? match[2] ?? "anonymous";
        currentFunction = { name, startLine: i, braceDepth: 0 };
      }
    }

    if (currentFunction) {
      for (const char of line) {
        if (char === "{") currentFunction.braceDepth++;
        if (char === "}") currentFunction.braceDepth--;
      }

      if (currentFunction.braceDepth <= 0 && i > currentFunction.startLine) {
        const length = i - currentFunction.startLine + 1;
        if (length > 10) {
          results.push({ name: currentFunction.name, lines: length });
        }
        currentFunction = undefined;
      }
    }
  }

  // Handle unclosed function (file end)
  if (currentFunction) {
    const length = lines.length - currentFunction.startLine;
    if (length > 10) {
      results.push({ name: currentFunction.name, lines: length });
    }
  }

  return results;
}

function estimateMaxNesting(lines: string[]): number {
  let maxDepth = 0;
  let currentDepth = 0;

  for (const line of lines) {
    // Skip comments and strings (rough heuristic)
    const stripped = line.replace(/\/\/.*$/, "").replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "");
    for (const char of stripped) {
      if (char === "{" || char === "(" || char === "[") {
        currentDepth++;
        if (currentDepth > maxDepth) maxDepth = currentDepth;
      }
      if (char === "}" || char === ")" || char === "]") {
        currentDepth = Math.max(0, currentDepth - 1);
      }
    }
  }

  return maxDepth;
}

function estimateAddedLines(toolName: "Write" | "Edit" | "MultiEdit", input: unknown): number {
  if (typeof input !== "object" || input === null) {
    return 0;
  }
  if (toolName === "Write") {
    const content = (input as { content?: unknown }).content;
    return typeof content === "string" ? lineCountOf(content) : 0;
  }
  if (toolName === "Edit") {
    const oldText = (input as { oldText?: unknown }).oldText;
    const newText = (input as { newText?: unknown }).newText;
    if (typeof newText !== "string") return 0;
    const oldLines = typeof oldText === "string" ? lineCountOf(oldText) : 0;
    return Math.max(0, lineCountOf(newText) - oldLines);
  }
  const edits = (input as { edits?: unknown }).edits;
  if (!Array.isArray(edits)) {
    return 0;
  }
  return edits.reduce((total, item) => {
    if (typeof item !== "object" || item === null) return total;
    const oldText = (item as { oldText?: unknown }).oldText;
    const newText = (item as { newText?: unknown }).newText;
    if (typeof newText !== "string") return total;
    const oldLines = typeof oldText === "string" ? lineCountOf(oldText) : 0;
    return total + Math.max(0, lineCountOf(newText) - oldLines);
  }, 0);
}

function isSubstantialEdit(
  toolName: "Write" | "Edit" | "MultiEdit",
  input: unknown,
  estimatedAddedLines: number,
): boolean {
  if (estimatedAddedLines >= SUBSTANTIAL_ADDED_LINES) {
    return true;
  }
  if (toolName !== "MultiEdit" || typeof input !== "object" || input === null) {
    return false;
  }
  const edits = (input as { edits?: unknown }).edits;
  return Array.isArray(edits) && edits.length >= MULTI_EDIT_SUBSTANTIAL_COUNT;
}

function lineCountOf(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
}

function formatBoundaryCheckSummary(violations: BoundaryViolation[]): string {
  if (violations.length === 0) return "clean";
  const critical = violations.filter((v) => v.severity === "critical").length;
  const warning = violations.filter((v) => v.severity === "warning").length;
  const info = violations.filter((v) => v.severity === "info").length;
  const parts: string[] = [];
  if (critical > 0) parts.push(`${critical} critical`);
  if (warning > 0) parts.push(`${warning} warning`);
  if (info > 0) parts.push(`${info} info`);
  return parts.join(", ");
}
