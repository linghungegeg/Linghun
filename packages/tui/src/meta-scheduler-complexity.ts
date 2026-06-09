export type TaskComplexityInput = {
  messageLength: number;
  mentionedFiles: number;
  toolCallsPlanned: number;
  hasMultiStep: boolean;
  estimatedTokens?: number;
};

export type ComplexityLevel = "trivial" | "simple" | "moderate" | "complex";

export type ComplexityEstimate = {
  level: ComplexityLevel;
  suggestedMaxTools: number;
  suggestedMaxAgents: number;
  rationale: string;
};

export function estimateComplexity(input: TaskComplexityInput): ComplexityEstimate {
  const { messageLength, mentionedFiles, toolCallsPlanned, hasMultiStep } = input;

  if (messageLength < 100 && mentionedFiles <= 1 && !hasMultiStep) {
    return {
      level: "trivial",
      suggestedMaxTools: 3,
      suggestedMaxAgents: 0,
      rationale: "Short message, single file, no multi-step",
    };
  }

  if (messageLength < 500 && mentionedFiles <= 3) {
    return {
      level: "simple",
      suggestedMaxTools: 8,
      suggestedMaxAgents: 1,
      rationale: "Moderate message, few files",
    };
  }

  if (mentionedFiles <= 8 || toolCallsPlanned <= 15) {
    return {
      level: "moderate",
      suggestedMaxTools: 20,
      suggestedMaxAgents: 3,
      rationale: "Multiple files or moderate tool usage planned",
    };
  }

  return {
    level: "complex",
    suggestedMaxTools: 50,
    suggestedMaxAgents: 5,
    rationale: "Many files and high tool usage",
  };
}
