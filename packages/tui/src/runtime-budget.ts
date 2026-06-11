import { readPositiveIntEnv } from "@linghun/shared";

export const LINGHUN_MAX_AGENTIC_TURNS = readPositiveIntEnv("LINGHUN_MAX_AGENTIC_TURNS", 100);
export const LINGHUN_MAX_EVIDENCE_TOOL_ROUNDS = 40;
export const LINGHUN_MAX_AGENT_CHILD_TURNS = 100;
export const LINGHUN_MAX_AGENT_CHILD_TOOL_ROUNDS = 40;
export const LINGHUN_MAX_TODO_ONLY_CONSECUTIVE_ROUNDS = 8;

// Progressive runaway guard: per-taskKind adaptive budgets.
// Base (edit/chat) starts hint earlier; agent/workflow get extended runway.
export const LINGHUN_MAX_TODO_ONLY_BASE = 5;
export const LINGHUN_MAX_TODO_ONLY_AGENT = 12;
export const LINGHUN_MAX_TODO_ONLY_WORKFLOW = 12;
export const LINGHUN_MAX_TODO_ONLY_VERIFICATION = 10;
export const LINGHUN_MAX_TODO_ONLY_CODE_FACT = 8;
// Kill grace: extra rounds past the suggested max before hard-stop.
export const LINGHUN_TODO_ONLY_KILL_GRACE = 3;

// Per-taskKind adaptive agent child turn budgets.
export const LINGHUN_AGENT_CHILD_TURNS_BASE = 50;
export const LINGHUN_AGENT_CHILD_TURNS_AGENT = 150;
export const LINGHUN_AGENT_CHILD_TURNS_WORKFLOW = 150;
export const LINGHUN_AGENT_CHILD_TURNS_VERIFICATION = 80;
export const LINGHUN_AGENT_CHILD_TURNS_CODE_FACT = 60;

// Per-taskKind adaptive tool round budgets (agent children / Verification).
export const LINGHUN_AGENT_TOOL_ROUNDS_BASE = 20;
export const LINGHUN_AGENT_TOOL_ROUNDS_AGENT = 60;
export const LINGHUN_AGENT_TOOL_ROUNDS_WORKFLOW = 60;
export const LINGHUN_AGENT_TOOL_ROUNDS_VERIFICATION = 40;
export const LINGHUN_AGENT_TOOL_ROUNDS_CODE_FACT = 30;

// Per-taskKind adaptive background concurrency.
export const LINGHUN_BACKGROUND_CONCURRENCY_BASE = 2;
export const LINGHUN_BACKGROUND_CONCURRENCY_AGENT = 6;
export const LINGHUN_BACKGROUND_CONCURRENCY_WORKFLOW = 8;
export const LINGHUN_BACKGROUND_CONCURRENCY_VERIFICATION = 4;
export const LINGHUN_BACKGROUND_CONCURRENCY_CODE_FACT = 3;

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
