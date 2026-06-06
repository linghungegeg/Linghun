function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const LINGHUN_MAX_AGENTIC_TURNS = readPositiveIntEnv("LINGHUN_MAX_AGENTIC_TURNS", 100);
export const LINGHUN_MAX_EVIDENCE_TOOL_ROUNDS = 40;
export const LINGHUN_MAX_AGENT_CHILD_TURNS = 100;
export const LINGHUN_MAX_AGENT_CHILD_TOOL_ROUNDS = 40;
export const LINGHUN_MAX_TODO_ONLY_CONSECUTIVE_ROUNDS = 1;

export const LINGHUN_VERIFICATION_COMMAND_TIMEOUT_MS = readPositiveIntEnv(
  "LINGHUN_VERIFICATION_COMMAND_TIMEOUT_MS",
  10 * 60 * 1000,
);

export const LINGHUN_DEFAULT_TOOL_RESULT_CHARS = 50_000;
export const LINGHUN_MAX_TOOL_RESULT_TOKENS = 100_000;
export const LINGHUN_BYTES_PER_TOKEN = 4;
export const LINGHUN_MAX_TOOL_RESULT_BYTES =
  LINGHUN_MAX_TOOL_RESULT_TOKENS * LINGHUN_BYTES_PER_TOKEN;
export const LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000;
export const LINGHUN_BASH_MAX_OUTPUT_DEFAULT = 30_000;
export const LINGHUN_BASH_MAX_OUTPUT_UPPER_LIMIT = 150_000;
export const LINGHUN_TASK_MAX_OUTPUT_DEFAULT = 32_000;
export const LINGHUN_TASK_MAX_OUTPUT_UPPER_LIMIT = 160_000;
export const LINGHUN_MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES = 1;
