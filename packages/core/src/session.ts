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
  | { type: "tool_call_start"; id: string; name: string; input: unknown; createdAt: string }
  | {
      type: "tool_call_end";
      id: string;
      output: {
        text: string;
        data?: unknown;
        truncated?: boolean;
        fullOutputPath?: string;
        changedFiles?: string[];
      };
      createdAt: string;
    }
  | {
      type: "permission_request";
      request: {
        id: string;
        toolName: string;
        mode: PermissionMode;
        risk: "low" | "medium" | "high";
        summary: string;
        files: string[];
        reason: string;
      };
      createdAt: string;
    }
  | {
      type: "permission_result";
      requestId: string;
      decision: "allow" | "ask" | "deny";
      reason: string;
      createdAt: string;
    }
  | {
      type: "plan_proposal";
      proposal: {
        id: string;
        title: string;
        options: { id: string; title: string; steps: string[]; risks: string[] }[];
      };
      createdAt: string;
    }
  | {
      type: "plan_decision";
      proposalId: string;
      optionId: string;
      decision: "accepted" | "rejected";
      createdAt: string;
    }
  | {
      type: "todo_update";
      items: {
        id: string;
        content: string;
        status: "pending" | "in_progress" | "completed" | "blocked";
        evidence?: string;
      }[];
      createdAt: string;
    }
  | {
      type: "diff_update";
      summary: {
        changedFiles: string[];
        addedLines: number;
        removedLines: number;
        summary: string;
        riskyFiles: string[];
      };
      createdAt: string;
    }
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
