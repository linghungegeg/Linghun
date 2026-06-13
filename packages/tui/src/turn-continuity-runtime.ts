import type { PolicyDecision, UserStateKind } from "./meta-scheduler-runtime.js";

export type TurnContinuityState = {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  dominantTaskKind: PolicyDecision["taskKind"] | null;
  taskDomainSwitched: boolean;
  lastUserStateKind: UserStateKind;
  userStatePersistence: number;
  totalTurns: number;
  messageLengthTrend: "shortening" | "stable" | "lengthening";
  trustScore: number;
};

type TurnContinuityInput = {
  taskKind: PolicyDecision["taskKind"];
  userStateKind: UserStateKind;
  hadToolFailure: boolean;
  hadProviderFailure: boolean;
  hadVerificationFailure: boolean;
  lastVerificationStatus?: string;
  userText: string;
  userCorrectedAssistant: boolean;
};

const INITIAL_TRUST_SCORE = 50;
const MAX_TRUST_SCORE = 100;
const MIN_TRUST_SCORE = 0;
const RECENT_TASK_KIND_WINDOW = 5;
const RECENT_MESSAGE_LENGTH_WINDOW = 5;

export function createInitialContinuityState(): TurnContinuityState {
  return {
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    dominantTaskKind: null,
    taskDomainSwitched: false,
    lastUserStateKind: "neutral",
    userStatePersistence: 1,
    totalTurns: 0,
    messageLengthTrend: "stable",
    trustScore: INITIAL_TRUST_SCORE,
  };
}

export function updateTurnContinuity(
  prev: TurnContinuityState,
  currentInput: TurnContinuityInput,
  recentTaskKinds: PolicyDecision["taskKind"][],
  recentMessageLengths: number[],
): { state: TurnContinuityState; recentTaskKinds: PolicyDecision["taskKind"][]; recentMessageLengths: number[] } {
  const hadAnyFailure =
    currentInput.hadToolFailure ||
    currentInput.hadProviderFailure ||
    currentInput.hadVerificationFailure;

  const consecutiveFailures = hadAnyFailure ? prev.consecutiveFailures + 1 : 0;

  const hadSuccess =
    !hadAnyFailure &&
    currentInput.lastVerificationStatus !== "fail" &&
    currentInput.lastVerificationStatus !== "partial";

  const consecutiveSuccesses = hadSuccess ? prev.consecutiveSuccesses + 1 : hadAnyFailure ? 0 : prev.consecutiveSuccesses;

  const nextRecentTaskKinds = [...recentTaskKinds, currentInput.taskKind].slice(-RECENT_TASK_KIND_WINDOW);
  const dominantTaskKind = computeDominant(nextRecentTaskKinds);

  const taskDomainSwitched =
    prev.dominantTaskKind !== null && currentInput.taskKind !== prev.dominantTaskKind;

  const userStatePersistence =
    currentInput.userStateKind === prev.lastUserStateKind
      ? prev.userStatePersistence + 1
      : 1;

  const nextRecentMessageLengths = [...recentMessageLengths, currentInput.userText.length].slice(
    -RECENT_MESSAGE_LENGTH_WINDOW,
  );
  const messageLengthTrend = computeMessageLengthTrend(nextRecentMessageLengths);

  let trustScore = prev.trustScore;
  if (currentInput.userCorrectedAssistant) {
    trustScore = Math.max(MIN_TRUST_SCORE, trustScore - 8);
  } else if (currentInput.hadProviderFailure) {
    trustScore = Math.max(MIN_TRUST_SCORE, trustScore - 5);
  } else if (currentInput.hadToolFailure) {
    trustScore = Math.max(MIN_TRUST_SCORE, trustScore - 3);
  } else if (hadSuccess && currentInput.lastVerificationStatus === "pass") {
    trustScore = Math.min(MAX_TRUST_SCORE, trustScore + 2);
  } else if (hadSuccess) {
    trustScore = Math.min(MAX_TRUST_SCORE, trustScore + 1);
  }

  return {
    state: {
      consecutiveFailures,
      consecutiveSuccesses,
      dominantTaskKind,
      taskDomainSwitched,
      lastUserStateKind: currentInput.userStateKind,
      userStatePersistence,
      totalTurns: prev.totalTurns + 1,
      messageLengthTrend,
      trustScore,
    },
    recentTaskKinds: nextRecentTaskKinds,
    recentMessageLengths: nextRecentMessageLengths,
  };
}

function computeDominant(
  kinds: PolicyDecision["taskKind"][],
): PolicyDecision["taskKind"] | null {
  if (kinds.length === 0) return null;
  const counts = new Map<PolicyDecision["taskKind"], number>();
  let best: PolicyDecision["taskKind"] = kinds[0]!;
  let bestCount = 0;
  for (const k of kinds) {
    const c = (counts.get(k) ?? 0) + 1;
    counts.set(k, c);
    if (c > bestCount) {
      bestCount = c;
      best = k;
    }
  }
  return best;
}

function computeMessageLengthTrend(lengths: number[]): TurnContinuityState["messageLengthTrend"] {
  if (lengths.length < 3) return "stable";
  const firstHalf = lengths.slice(0, Math.floor(lengths.length / 2));
  const secondHalf = lengths.slice(Math.floor(lengths.length / 2));
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const ratio = firstAvg > 0 ? secondAvg / firstAvg : 1;
  if (ratio < 0.7) return "shortening";
  if (ratio > 1.3) return "lengthening";
  return "stable";
}
