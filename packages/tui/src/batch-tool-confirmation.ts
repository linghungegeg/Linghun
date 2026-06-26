// batch-tool-confirmation.ts — Phase R7 Task 2
//
// Multi-tool batch confirmation: groups consecutive tool calls with the same
// risk level and policy decision into a single confirmation prompt, reducing
// permission fatigue when the model issues N similar calls in one round.
//
// Conservative rules:
//   - Only batch when ALL tools in the batch have the SAME tool name AND same risk.
//   - Different tool names → individual_confirm (even if same risk).
//   - Destructive / high-risk semantic → always individual_confirm.
//   - auto_allow_* tools are grouped into auto_allow batches (no prompt).

import type { PolicyVerdict, SemanticClass } from "./permission-policy-engine.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ToolCallGroup = {
  id: string;
  toolName: string;
  input: unknown;
};

export type ConfirmationBatch = {
  decision: "auto_allow" | "batch_confirm" | "individual_confirm";
  toolCalls: ToolCallGroup[];
  riskLevel?: string;
  summaryText?: string;
};

export type BatchConfirmationPlan = {
  batches: ConfirmationBatch[];
};

export type ClassifyFn = (toolName: string, input: unknown) => PolicyVerdict;

// ---------------------------------------------------------------------------
// Semantic classes that always require individual confirmation
// ---------------------------------------------------------------------------

const ALWAYS_INDIVIDUAL_SEMANTICS = new Set<SemanticClass>([
  "destructive",
  "secret_read",
  "outside_workspace",
]);

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export function groupToolCallsForConfirmation(
  toolCalls: ToolCallGroup[],
  classify: ClassifyFn,
): BatchConfirmationPlan {
  if (toolCalls.length === 0) {
    return { batches: [] };
  }
  if (toolCalls.length === 1) {
    const verdict = classify(toolCalls[0]!.toolName, toolCalls[0]!.input);
    return {
      batches: [createSingleBatch(toolCalls[0]!, verdict)],
    };
  }

  const classified = toolCalls.map((tc) => ({
    toolCall: tc,
    verdict: classify(tc.toolName, tc.input),
  }));

  const batches: ConfirmationBatch[] = [];
  let i = 0;

  while (i < classified.length) {
    const current = classified[i]!;

    // Destructive / high-risk always individual
    if (ALWAYS_INDIVIDUAL_SEMANTICS.has(current.verdict.semantic)) {
      batches.push({
        decision: "individual_confirm",
        toolCalls: [current.toolCall],
        riskLevel: current.verdict.semantic,
      });
      i += 1;
      continue;
    }

    // auto_allow_*: collect consecutive auto_allow with same tool name
    if (isAutoAllowDecision(current.verdict.decision)) {
      const group: ToolCallGroup[] = [current.toolCall];
      let j = i + 1;
      while (
        j < classified.length &&
        isAutoAllowDecision(classified[j]!.verdict.decision) &&
        classified[j]!.toolCall.toolName === current.toolCall.toolName
      ) {
        group.push(classified[j]!.toolCall);
        j += 1;
      }
      batches.push({
        decision: "auto_allow",
        toolCalls: group,
        riskLevel: current.verdict.semantic,
      });
      i = j;
      continue;
    }

    // require_permission: batch consecutive calls with SAME tool name AND same semantic
    if (current.verdict.decision === "require_permission") {
      const group: ToolCallGroup[] = [current.toolCall];
      let j = i + 1;
      while (
        j < classified.length &&
        classified[j]!.verdict.decision === "require_permission" &&
        classified[j]!.toolCall.toolName === current.toolCall.toolName &&
        classified[j]!.verdict.semantic === current.verdict.semantic &&
        !ALWAYS_INDIVIDUAL_SEMANTICS.has(classified[j]!.verdict.semantic)
      ) {
        group.push(classified[j]!.toolCall);
        j += 1;
      }

      if (group.length === 1) {
        batches.push({
          decision: "individual_confirm",
          toolCalls: group,
          riskLevel: current.verdict.semantic,
        });
      } else {
        batches.push({
          decision: "batch_confirm",
          toolCalls: group,
          riskLevel: current.verdict.semantic,
          summaryText: formatBatchSummary(group, current.verdict.semantic),
        });
      }
      i = j;
      continue;
    }

    // Fallback: individual
    batches.push({
      decision: "individual_confirm",
      toolCalls: [current.toolCall],
      riskLevel: current.verdict.semantic,
    });
    i += 1;
  }

  return { batches };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSingleBatch(toolCall: ToolCallGroup, verdict: PolicyVerdict): ConfirmationBatch {
  if (isAutoAllowDecision(verdict.decision)) {
    return { decision: "auto_allow", toolCalls: [toolCall], riskLevel: verdict.semantic };
  }
  return {
    decision: "individual_confirm",
    toolCalls: [toolCall],
    riskLevel: verdict.semantic,
  };
}

function isAutoAllowDecision(decision: PolicyVerdict["decision"]): boolean {
  return decision === "auto_allow_readonly" || decision === "auto_allow_development";
}

function formatBatchSummary(group: ToolCallGroup[], semantic: SemanticClass): string {
  const toolName = group[0]?.toolName ?? "unknown";
  const count = group.length;
  const riskLabel = semantic === "unknown" ? "medium" : semantic;
  return `${count} ${toolName} calls (${riskLabel} risk)`;
}
