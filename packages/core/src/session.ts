import type { Language, PermissionMode } from "@linghun/shared";

export type CostSummary = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedUsd: number;
  estimatedCny: number;
};

export type CacheSummary = {
  hitRate: number | null;
  readTokens: number;
  writeTokens: number;
};

export type Session = {
  id: string;
  projectPath: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  permissionMode: PermissionMode;
  language: Language;
  transcriptPath: string;
  summary?: string;
  cost: CostSummary;
  cache: CacheSummary;
};

export type TranscriptEvent =
  | { type: "session_start"; sessionId: string; projectPath: string; createdAt: string }
  | { type: "user_message"; id: string; text: string; createdAt: string }
  | { type: "assistant_text_delta"; id: string; text: string; createdAt: string }
  | { type: "session_end"; sessionId: string; createdAt: string };

export type SessionListItem = Pick<
  Session,
  "id" | "projectName" | "projectPath" | "createdAt" | "updatedAt" | "summary" | "transcriptPath"
>;

export function createEmptyCostSummary(): CostSummary {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedUsd: 0,
    estimatedCny: 0,
  };
}

export function createEmptyCacheSummary(): CacheSummary {
  return {
    hitRate: null,
    readTokens: 0,
    writeTokens: 0,
  };
}
