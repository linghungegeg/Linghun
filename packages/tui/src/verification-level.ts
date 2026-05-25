/**
 * verification-level.ts — Unified verification level classifier
 *
 * Distinguishes mock / source / local / build / real-smoke PASS levels.
 * Prevents partial/simulated/fallback/mocked/source-only results from being
 * reported or upgraded to "ready" / "PASS" / "mature".
 *
 * D.14A Global Architecture Guard — Anti-Hallucination Runtime Enhancement.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Verification evidence levels, ordered from weakest to strongest.
 * Each level represents the actual verification method used.
 */
export type VerificationEvidenceLevel = "mock" | "source" | "local" | "build" | "real-smoke";

/**
 * Classification result for a single verification claim.
 */
export type VerificationLevelClassification = {
  level: VerificationEvidenceLevel;
  isRealSmoke: boolean;
  canClaimMature: boolean;
  canClaimPass: boolean;
  upgradeBlocked: boolean;
  blockReason?: string;
  requiredForMature: string;
};

/**
 * Input signals used to classify a verification claim.
 */
export type VerificationLevelInput = {
  /** Was a real process spawned and observed? */
  realProcessObserved?: boolean;
  /** Was a real provider endpoint hit with a real response? */
  realProviderHit?: boolean;
  /** Was a real TUI rendered and interacted with? */
  realTuiRendered?: boolean;
  /** Was only source code read/analyzed? */
  sourceOnlyAnalysis?: boolean;
  /** Was a mock/stub/fake used? */
  mockUsed?: boolean;
  /** Was a local test runner used (vitest, jest, etc.)? */
  localTestRunner?: boolean;
  /** Was a build command run successfully? */
  buildPassed?: boolean;
  /** Was a fallback path used instead of the main path? */
  fallbackUsed?: boolean;
  /** Was the result simulated or partial? */
  simulatedOrPartial?: boolean;
  /** Runner adapter type if applicable */
  runnerAdapter?: "native" | "node";
  /** Runner status if applicable */
  runnerStatus?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<VerificationEvidenceLevel, number> = {
  mock: 0,
  source: 1,
  local: 2,
  build: 3,
  "real-smoke": 4,
};

const LEVEL_MATURITY_THRESHOLD: VerificationEvidenceLevel = "real-smoke";
const LEVEL_PASS_THRESHOLD: VerificationEvidenceLevel = "build";

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify the verification evidence level from input signals.
 * Returns the strongest level that the evidence actually supports.
 */
export function classifyVerificationLevel(
  input: VerificationLevelInput,
): VerificationLevelClassification {
  const level = inferLevel(input);
  const levelOrder = LEVEL_ORDER[level];
  const canClaimMature = levelOrder >= LEVEL_ORDER[LEVEL_MATURITY_THRESHOLD];
  const canClaimPass = levelOrder >= LEVEL_ORDER[LEVEL_PASS_THRESHOLD];
  const upgradeBlocked = hasUpgradeBlocker(input);

  return {
    level,
    isRealSmoke: level === "real-smoke",
    canClaimMature: canClaimMature && !upgradeBlocked,
    canClaimPass: canClaimPass && !upgradeBlocked,
    upgradeBlocked,
    blockReason: upgradeBlocked ? getBlockReason(input) : undefined,
    requiredForMature: getRequiredForMature(level, input),
  };
}

/**
 * Check if a verification status string represents a non-upgradeable result.
 * Used to prevent report-level inflation.
 */
export function isNonUpgradeableStatus(status: string): boolean {
  const lower = status.toLowerCase();
  return (
    lower.includes("partial") ||
    lower.includes("simulated") ||
    lower.includes("fallback") ||
    lower.includes("mocked") ||
    lower.includes("source-only") ||
    lower.includes("node_fallback") ||
    lower === "skipped" ||
    lower === "stale"
  );
}

/**
 * Validate that a report claim does not inflate verification level.
 * Returns a warning string if inflation is detected, undefined otherwise.
 */
export function detectVerificationInflation(
  claimedStatus: string,
  actualLevel: VerificationEvidenceLevel,
): string | undefined {
  const claimedLower = claimedStatus.toLowerCase();
  const isMatureClaim =
    claimedLower.includes("mature") ||
    claimedLower.includes("ready") ||
    claimedLower.includes("production");
  const isPassClaim = claimedLower === "pass" || claimedLower.includes("pass");

  if (isMatureClaim && LEVEL_ORDER[actualLevel] < LEVEL_ORDER[LEVEL_MATURITY_THRESHOLD]) {
    return `Verification inflation: claimed "${claimedStatus}" but actual level is "${actualLevel}". Real smoke required for mature/ready claims.`;
  }

  if (isPassClaim && LEVEL_ORDER[actualLevel] < LEVEL_ORDER[LEVEL_PASS_THRESHOLD]) {
    return `Verification inflation: claimed "${claimedStatus}" but actual level is "${actualLevel}". At least build-level verification required for PASS.`;
  }

  return undefined;
}

/**
 * Classify runner evidence level specifically.
 * Runner fallback (node adapter) cannot claim native runner maturity.
 */
export function classifyRunnerVerificationLevel(
  adapter: "native" | "node",
  status: string,
  fallbackReason?: string,
): VerificationLevelClassification {
  if (adapter === "node" || fallbackReason) {
    return classifyVerificationLevel({
      fallbackUsed: true,
      localTestRunner: true,
      runnerAdapter: adapter,
      runnerStatus: status,
    });
  }

  if (status === "completed") {
    return classifyVerificationLevel({
      realProcessObserved: true,
      runnerAdapter: adapter,
      runnerStatus: status,
    });
  }

  return classifyVerificationLevel({
    localTestRunner: true,
    simulatedOrPartial: status !== "running",
    runnerAdapter: adapter,
    runnerStatus: status,
  });
}

/**
 * Classify provider evidence level.
 * Fallback/mock providers cannot claim real provider maturity.
 */
export function classifyProviderVerificationLevel(input: {
  realEndpointHit: boolean;
  fallbackUsed: boolean;
  mockUsed: boolean;
  cooldownActive: boolean;
}): VerificationLevelClassification {
  return classifyVerificationLevel({
    realProviderHit: input.realEndpointHit && !input.fallbackUsed && !input.mockUsed,
    mockUsed: input.mockUsed,
    fallbackUsed: input.fallbackUsed || input.cooldownActive,
    simulatedOrPartial: input.cooldownActive,
  });
}

/**
 * Format a verification level for report/log output.
 */
export function formatVerificationLevel(classification: VerificationLevelClassification): string {
  const parts = [`level=${classification.level}`];
  if (classification.upgradeBlocked) {
    parts.push(`blocked=${classification.blockReason ?? "upgrade-blocked"}`);
  }
  if (!classification.canClaimPass) {
    parts.push("pass=not-claimable");
  }
  if (!classification.canClaimMature) {
    parts.push(`mature-requires=${classification.requiredForMature}`);
  }
  return parts.join("; ");
}

/**
 * Compare two verification levels. Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVerificationLevels(
  a: VerificationEvidenceLevel,
  b: VerificationEvidenceLevel,
): number {
  return LEVEL_ORDER[a] - LEVEL_ORDER[b];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function inferLevel(input: VerificationLevelInput): VerificationEvidenceLevel {
  // Mock/fallback/simulated always caps at mock level regardless of other signals
  if (input.mockUsed || input.fallbackUsed || input.simulatedOrPartial) {
    // Source level if local test runner is also present (mocked local tests)
    if (
      input.localTestRunner &&
      input.mockUsed &&
      !input.fallbackUsed &&
      !input.simulatedOrPartial
    ) {
      return "source";
    }
    return "mock";
  }

  // Real smoke requires actual process/provider/TUI observation without fallback
  if (input.realProcessObserved || input.realProviderHit || input.realTuiRendered) {
    return "real-smoke";
  }

  // Build level: build passed without mocks/fallback
  if (input.buildPassed) {
    return "build";
  }

  // Local level: local test runner used without mocks
  if (input.localTestRunner) {
    return "local";
  }

  // Source level: only source analysis
  if (input.sourceOnlyAnalysis) {
    return "source";
  }

  // Default: source
  return "source";
}

function hasUpgradeBlocker(input: VerificationLevelInput): boolean {
  return Boolean(input.fallbackUsed || input.simulatedOrPartial || input.mockUsed);
}

function getBlockReason(input: VerificationLevelInput): string {
  if (input.fallbackUsed) return "fallback-path-used";
  if (input.simulatedOrPartial) return "simulated-or-partial";
  if (input.mockUsed) return "mock-used";
  return "unknown-blocker";
}

function getRequiredForMature(
  currentLevel: VerificationEvidenceLevel,
  input: VerificationLevelInput,
): string {
  if (currentLevel === "real-smoke") return "already-mature";
  const needs: string[] = [];
  if (!input.realProcessObserved && !input.realProviderHit && !input.realTuiRendered) {
    needs.push("real-smoke-observation");
  }
  if (input.fallbackUsed) {
    needs.push("main-path-execution");
  }
  if (input.mockUsed) {
    needs.push("real-dependency-verification");
  }
  return needs.length > 0 ? needs.join("+") : "real-smoke-required";
}
