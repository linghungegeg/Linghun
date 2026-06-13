/**
 * runtime-path-marker.ts — TUI Runtime Path Classification
 *
 * Classifies the actual TUI runtime path: Ink / plain / non-TTY / forced-legacy.
 * Ensures fallback paths are never reported as mature main-path verification.
 * Main path vs fallback must be explicitly distinguished in all runtime contexts.
 *
 * D.14A Global Architecture Guard — Anti-Hallucination Runtime Enhancement.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The actual TUI rendering runtime in use.
 */
export type TuiRuntimePath = "ink" | "plain" | "non-tty" | "forced-legacy";

/**
 * Classification of whether the current path is the main (intended) path
 * or a fallback/degraded path.
 */
export type RuntimePathKind = "main" | "fallback";

/**
 * Complete runtime path marker for a TUI session.
 */
export type RuntimePathMarker = {
  path: TuiRuntimePath;
  kind: RuntimePathKind;
  isMainPath: boolean;
  isFallback: boolean;
  canClaimMature: boolean;
  degradedReason?: string;
  detectionMethod: RuntimePathDetectionMethod;
};

/**
 * How the runtime path was detected.
 */
export type RuntimePathDetectionMethod =
  | "env-override"
  | "tty-probe"
  | "ink-available"
  | "forced-by-config"
  | "default";

/**
 * Input signals for runtime path detection.
 */
export type RuntimePathInput = {
  /** Is stdout a TTY? */
  isTTY?: boolean;
  /** Is Ink rendering available and loaded? */
  inkAvailable?: boolean;
  /** Is there an env override forcing a specific mode? */
  envOverride?: string;
  /** Is legacy mode forced by config? */
  forcedLegacy?: boolean;
  /** Is the process running in CI? */
  isCI?: boolean;
  /** Is raw mode available on stdin? */
  rawModeAvailable?: boolean;
  /** Windows console mode */
  windowsConsoleMode?: "conhost" | "windows-terminal" | "unknown";
};

/**
 * Startup path classification for CLI entry point.
 */
export type StartupPathMarker = {
  entryKind: "source" | "dist" | "global-bin" | "desktop-cmd" | "unknown";
  isVerifiedCurrent: boolean;
  staleRisk: boolean;
  staleReason?: string;
};

/**
 * Input for startup path classification.
 */
export type StartupPathInput = {
  /** The actual argv[1] or entry script path */
  entryPath?: string;
  /** Whether running from source (ts-node, tsx, vitest) */
  isSourceExecution?: boolean;
  /** Whether running from compiled dist */
  isDistExecution?: boolean;
  /** Whether running from a global bin link */
  isGlobalBin?: boolean;
  /** Whether running from desktop cmd script */
  isDesktopCmd?: boolean;
  /** Package version from package.json */
  packageVersion?: string;
  /** Git HEAD at startup */
  gitHead?: string;
};

// ---------------------------------------------------------------------------
// Runtime Path Classification
// ---------------------------------------------------------------------------

/**
 * Classify the TUI runtime path from environment signals.
 */
export function classifyRuntimePath(input: RuntimePathInput): RuntimePathMarker {
  // Env override takes highest priority
  if (input.envOverride) {
    const path = parseEnvOverridePath(input.envOverride);
    return {
      path,
      kind: path === "ink" ? "main" : "fallback",
      isMainPath: path === "ink",
      isFallback: path !== "ink",
      canClaimMature: path === "ink",
      degradedReason: path !== "ink" ? `env-override=${input.envOverride}` : undefined,
      detectionMethod: "env-override",
    };
  }

  // Forced legacy by config
  if (input.forcedLegacy) {
    return {
      path: "forced-legacy",
      kind: "fallback",
      isMainPath: false,
      isFallback: true,
      canClaimMature: false,
      degradedReason: "forced-legacy-by-config",
      detectionMethod: "forced-by-config",
    };
  }

  // Non-TTY (CI, piped, redirected)
  if (input.isTTY === false || input.isCI) {
    return {
      path: "non-tty",
      kind: "fallback",
      isMainPath: false,
      isFallback: true,
      canClaimMature: false,
      degradedReason: input.isCI ? "ci-environment" : "non-tty-output",
      detectionMethod: "tty-probe",
    };
  }

  // Ink available and TTY present
  if (input.inkAvailable && input.isTTY) {
    return {
      path: "ink",
      kind: "main",
      isMainPath: true,
      isFallback: false,
      canClaimMature: true,
      detectionMethod: "ink-available",
    };
  }

  // TTY but no Ink — plain mode
  if (input.isTTY) {
    return {
      path: "plain",
      kind: "fallback",
      isMainPath: false,
      isFallback: true,
      canClaimMature: false,
      degradedReason: "ink-unavailable",
      detectionMethod: "tty-probe",
    };
  }

  // Default fallback
  return {
    path: "plain",
    kind: "fallback",
    isMainPath: false,
    isFallback: true,
    canClaimMature: false,
    degradedReason: "unable-to-determine-tty",
    detectionMethod: "default",
  };
}

/**
 * Classify the CLI startup/entry path.
 */
export function classifyStartupPath(input: StartupPathInput): StartupPathMarker {
  const entryKind = inferEntryKind(input);
  const staleRisk = hasStaleRisk(entryKind, input);

  return {
    entryKind,
    isVerifiedCurrent: !staleRisk && entryKind === "source",
    staleRisk,
    staleReason: staleRisk ? getStaleReason(entryKind, input) : undefined,
  };
}

/**
 * Check if a runtime path marker allows claiming TUI maturity.
 * Fallback paths cannot claim TUI maturity regardless of test results.
 */
export function canClaimTuiMaturity(marker: RuntimePathMarker): boolean {
  return marker.isMainPath && marker.canClaimMature;
}

/**
 * Check if a startup path allows claiming "current source verified".
 * Old dist/global bin cannot be mistaken for current source verification.
 */
export function canClaimCurrentVerification(marker: StartupPathMarker): boolean {
  return marker.isVerifiedCurrent && !marker.staleRisk;
}

/**
 * Detect if a report claim inflates the runtime path status.
 */
export function detectRuntimePathInflation(
  claimedStatus: string,
  marker: RuntimePathMarker,
): string | undefined {
  const lower = claimedStatus.toLowerCase();
  const isMatureClaim =
    lower.includes("mature") ||
    lower.includes("ready") ||
    lower.includes("production") ||
    lower.includes("ink-verified");

  if (isMatureClaim && !marker.canClaimMature) {
    return `Runtime path inflation: claimed "${claimedStatus}" but actual path is "${marker.path}" (${marker.kind}). ${marker.degradedReason ?? "fallback-active"}`;
  }

  return undefined;
}

/**
 * Format a runtime path marker for log/report output.
 */
export function formatRuntimePathMarker(marker: RuntimePathMarker): string {
  const parts = [
    `path ${marker.path}`,
    `kind ${marker.kind}`,
    `detection ${marker.detectionMethod}`,
  ];
  if (marker.degradedReason) {
    parts.push(`degraded ${marker.degradedReason}`);
  }
  if (!marker.canClaimMature) {
    parts.push("mature not claimable");
  }
  return parts.join("; ");
}

/**
 * Format a startup path marker for log/report output.
 */
export function formatStartupPathMarker(marker: StartupPathMarker): string {
  const parts = [`entry ${marker.entryKind}`, `verified ${marker.isVerifiedCurrent}`];
  if (marker.staleRisk) {
    parts.push(`stale risk ${marker.staleReason ?? "true"}`);
  }
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseEnvOverridePath(value: string): TuiRuntimePath {
  const lower = value.toLowerCase().trim();
  if (lower === "ink") return "ink";
  if (lower === "plain") return "plain";
  if (lower === "non-tty" || lower === "nontty") return "non-tty";
  if (lower === "legacy" || lower === "forced-legacy") return "forced-legacy";
  return "plain";
}

function inferEntryKind(input: StartupPathInput): StartupPathMarker["entryKind"] {
  if (input.isSourceExecution) return "source";
  if (input.isDistExecution) return "dist";
  if (input.isGlobalBin) return "global-bin";
  if (input.isDesktopCmd) return "desktop-cmd";
  return "unknown";
}

function hasStaleRisk(entryKind: StartupPathMarker["entryKind"], input: StartupPathInput): boolean {
  // Source execution is always current
  if (entryKind === "source") return false;

  // Dist/global-bin/desktop-cmd may be stale
  if (entryKind === "dist" || entryKind === "global-bin" || entryKind === "desktop-cmd") {
    return true;
  }

  // Unknown entry is risky
  if (entryKind === "unknown") return true;

  return !input.packageVersion;
}

function getStaleReason(
  entryKind: StartupPathMarker["entryKind"],
  _input: StartupPathInput,
): string {
  if (entryKind === "dist") return "dist-may-be-outdated";
  if (entryKind === "global-bin") return "global-bin-may-be-outdated";
  if (entryKind === "desktop-cmd") return "desktop-cmd-may-be-outdated";
  if (entryKind === "unknown") return "unknown-entry-point";
  return "cannot-verify-currency";
}
