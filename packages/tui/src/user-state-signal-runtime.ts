import type { UserStateDecision, UserStateKind } from "./meta-scheduler-runtime.js";
import type { BackgroundTaskState } from "./tui-data-types.js";

export type UserStateRuntimeEvent = {
  kind: "tool_failure" | "provider_failure" | "verification_failure" | "user_feedback";
  summary: string;
  createdAtMs?: number;
};

export type UserStateRuntimeContext = {
  userText: string;
  events?: UserStateRuntimeEvent[];
  repeatedFailureCount?: number;
  loading?: boolean;
  activePrompt?: boolean;
  otherPanelOpen?: boolean;
  dismissedUntilMs?: number;
  cooldownUntilMs?: number;
  policyEnabled?: boolean;
  backgroundTasks?: BackgroundTaskState[];
  nowMs?: number;
};

export type UserStateSignal = {
  decision: UserStateDecision;
  evidence: Array<{ type: string; summary: string; weight: number }>;
  suppressed: boolean;
  suppressedReason?: "policy_disabled" | "dismissed" | "cooldown" | "busy_surface";
};

type DecisionOptions = { memorySummary?: string; commandFirst?: boolean };

const LOW_WEIGHT_TEXT_HINTS: Array<{ kind: Exclude<UserStateKind, "neutral">; pattern: RegExp }> = [
  {
    kind: "frustrated",
    pattern:
      /(?:烦|崩溃|离谱|又错|还错|别糊弄|别空泛|别瞎猜|frustrated|annoyed|stop guessing|no fluff|too noisy)/iu,
  },
  {
    kind: "trust_repair",
    pattern:
      /(?:别再|不要再|上次|之前.*(?:错|漏|幻觉|没看|没读|误判)|信任|trust repair|you missed|you were wrong)/iu,
  },
  {
    kind: "confused",
    pattern:
      /(?:不懂|没懂|看不懂|为什么|啥意思|解释一下|先解释|confused|don't understand|explain|why\b)/iu,
  },
  {
    kind: "strategic_exploration",
    pattern:
      /(?:讨论|分析方案|架构判断|路线|取舍|探索|先别写|不要实现|brainstorm|strategy|explore|discuss|do not implement)/iu,
  },
  {
    kind: "decisive_command",
    pattern:
      /(?:直接给(?:我)?命令|只给命令|给(?:我)?命令|命令即可|不用解释|command only|just commands|no explanation|do it now|run it now)/iu,
  },
  {
    kind: "high_stakes_release",
    pattern:
      /(?:发布|上线|开源发布|稳定点|release|deploy|production|open-?source|smoke-ready|beta pass|stable point)/iu,
  },
];

export function evaluateUserStateSignal(input: UserStateRuntimeContext): UserStateSignal {
  const nowMs = input.nowMs ?? Date.now();
  if (input.policyEnabled === false) {
    return suppressedSignal("policy_disabled");
  }
  if ((input.dismissedUntilMs ?? 0) > nowMs) {
    return suppressedSignal("dismissed");
  }
  if ((input.cooldownUntilMs ?? 0) > nowMs) {
    return suppressedSignal("cooldown");
  }
  if (input.loading || input.activePrompt || input.otherPanelOpen) {
    return suppressedSignal("busy_surface");
  }

  const evidence = collectEvidence(input);
  const best = evidence
    .filter((item) => item.kind !== "neutral")
    .sort((a, b) => b.weight - a.weight)[0];
  if (!best || best.weight < 0.55) {
    return {
      decision: createUserStateDecision("neutral", 0.5),
      evidence: evidence.map((item) => ({
        type: item.type,
        summary: item.summary,
        weight: item.weight,
      })),
      suppressed: false,
    };
  }

  return {
    decision: createUserStateDecision(best.kind, Math.min(0.96, best.weight), {
      commandFirst: hasCommandFirstHint(input.userText),
      memorySummary: memorySummaryFor(best.kind),
    }),
    evidence: evidence.map((item) => ({
      type: item.type,
      summary: item.summary,
      weight: item.weight,
    })),
    suppressed: false,
  };
}

export function hasFrustrationTextHint(text: string): boolean {
  return LOW_WEIGHT_TEXT_HINTS[0]?.pattern.test(text) === true;
}

function collectEvidence(input: UserStateRuntimeContext): Array<{
  kind: UserStateKind;
  type: string;
  summary: string;
  weight: number;
}> {
  const evidence: Array<{ kind: UserStateKind; type: string; summary: string; weight: number }> =
    [];
  const repeated = input.repeatedFailureCount ?? 0;
  if (repeated >= 2) {
    evidence.push({
      kind: "frustrated",
      type: "repeated_failure",
      summary: `repeated failures: ${repeated}`,
      weight: repeated >= 3 ? 0.9 : 0.72,
    });
  }
  for (const event of input.events ?? []) {
    if (event.kind === "user_feedback") {
      evidence.push(classifyFeedbackEvent(event.summary));
      continue;
    }
    if (event.kind === "verification_failure") {
      evidence.push({
        kind: "frustrated",
        type: event.kind,
        summary: event.summary,
        weight: 0.68,
      });
      continue;
    }
    if (event.kind === "tool_failure" || event.kind === "provider_failure") {
      evidence.push({
        kind: repeated >= 1 ? "frustrated" : "neutral",
        type: event.kind,
        summary: event.summary,
        weight: repeated >= 1 ? 0.62 : 0.35,
      });
    }
  }
  if (
    /(?:又错了|还错|再次失败|反复失败|you were wrong again|failed again)/iu.test(input.userText)
  ) {
    evidence.push({
      kind: "frustrated",
      type: "explicit_feedback",
      summary: "user explicitly reports repeated failure",
      weight: 0.74,
    });
  }
  for (const hint of LOW_WEIGHT_TEXT_HINTS) {
    if (hint.pattern.test(input.userText)) {
      evidence.push({
        kind: hint.kind,
        type: "text_hint",
        summary: "low-weight user wording hint",
        weight: textHintWeight(hint.kind),
      });
    }
  }
  if (
    (input.backgroundTasks ?? []).some(
      (task) => task.status === "stale" || task.status === "timeout",
    )
  ) {
    evidence.push({
      kind: "trust_repair",
      type: "runtime_state",
      summary: "background task stale/timeout",
      weight: 0.64,
    });
  }
  return evidence;
}

function classifyFeedbackEvent(summary: string): {
  kind: UserStateKind;
  type: string;
  summary: string;
  weight: number;
} {
  if (/(?:错|漏|幻觉|没看|没读|you missed|wrong|hallucinat)/iu.test(summary)) {
    return { kind: "trust_repair", type: "user_feedback", summary, weight: 0.86 };
  }
  if (/(?:不懂|解释|confused|explain)/iu.test(summary)) {
    return { kind: "confused", type: "user_feedback", summary, weight: 0.8 };
  }
  if (/(?:发布|上线|release|deploy|production|stable)/iu.test(summary)) {
    return { kind: "high_stakes_release", type: "user_feedback", summary, weight: 0.88 };
  }
  return { kind: "frustrated", type: "user_feedback", summary, weight: 0.74 };
}

function suppressedSignal(
  reason: NonNullable<UserStateSignal["suppressedReason"]>,
): UserStateSignal {
  return {
    decision: createUserStateDecision("neutral", 0.35),
    evidence: [{ type: reason, summary: reason, weight: 1 }],
    suppressed: true,
    suppressedReason: reason,
  };
}

function createUserStateDecision(
  kind: UserStateKind,
  confidence: number,
  options: DecisionOptions = {},
): UserStateDecision {
  const sourceFactFirst = kind === "frustrated" || kind === "trust_repair";
  const highStakes = kind === "high_stakes_release";
  const confused = kind === "confused";
  const strategic = kind === "strategic_exploration";
  const decisive = kind === "decisive_command" || options.commandFirst === true;
  const strengthened = sourceFactFirst || highStakes;
  const route =
    kind === "trust_repair" || kind === "frustrated"
      ? "source_fact_first"
      : highStakes
        ? "release_gate"
        : confused
          ? "explain_first"
          : strategic
            ? "discussion_only"
            : decisive
              ? "command_first"
              : "normal";
  return {
    kind,
    confidence,
    interactionPlan: {
      route,
      sourceFactsFirst: sourceFactFirst,
      commandFirst: decisive,
      explainFirst: confused,
      discussionOnly: strategic,
      allowImplementationPush: !(confused || strategic),
    },
    verificationPlan: {
      strength: highStakes ? "release" : strengthened ? "strengthened" : "normal",
      requireSourceFacts: sourceFactFirst || highStakes,
      forbidEarlyPass: sourceFactFirst || highStakes,
      requireDirtyTreeCheck: highStakes,
      requireBuild: highStakes,
      requireFocusedTests: strengthened || highStakes,
      requireStabilityBoundary: highStakes,
    },
    detailPlan: {
      style: decisive
        ? "command_first"
        : confused
          ? "explain_first"
          : strategic
            ? "discussion"
            : kind === "neutral"
              ? "normal"
              : "concise",
      background: decisive ? "minimal" : confused || strategic ? "expanded" : "normal",
    },
    notificationPlan: {
      quiet: kind === "frustrated" || kind === "trust_repair" || decisive,
      suppressGenericHints: kind !== "neutral",
      maxHints: kind === "neutral" ? 3 : 2,
    },
    memoryCandidate: {
      shouldCreate: Boolean(options.memorySummary),
      scope: "session",
      ...(options.memorySummary ? { summary: options.memorySummary } : {}),
      autoAccept: false,
    },
  };
}

function hasCommandFirstHint(text: string): boolean {
  return LOW_WEIGHT_TEXT_HINTS.some(
    (hint) => hint.kind === "decisive_command" && hint.pattern.test(text),
  );
}

function textHintWeight(kind: UserStateKind): number {
  if (kind === "frustrated") return 0.42;
  if (kind === "trust_repair") return 0.82;
  if (kind === "high_stakes_release") return 0.84;
  return 0.58;
}

function memorySummaryFor(kind: UserStateKind): string | undefined {
  if (kind === "trust_repair") {
    return "User is repairing trust after prior mismatch; require source facts before delivery summaries.";
  }
  if (kind === "frustrated") {
    return "User is frustrated after repeated failures; reduce generic hints and strengthen source-first verification.";
  }
  if (kind === "high_stakes_release") {
    return "User treats release/deploy/open-source readiness as high stakes; require dirty tree/build/focused verification/stability boundary.";
  }
  return undefined;
}
