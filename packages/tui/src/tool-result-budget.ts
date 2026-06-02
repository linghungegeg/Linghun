import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { ModelMessage } from "@linghun/providers";
import {
  LINGHUN_DEFAULT_TOOL_RESULT_CHARS,
  LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  LINGHUN_MAX_TOOL_RESULT_BYTES,
} from "./runtime-budget.js";

export type ToolResultBudgetArtifact = {
  id: string;
  toolUseId: string;
  path: string;
  relativePath: string;
  bytes: number;
  chars: number;
  sha256: string;
  previewChars: number;
  preview: string;
  hasMore: boolean;
};

export type ToolResultBudgetRecord = {
  toolUseId: string;
  originalChars: number;
  replacementChars: number;
  artifact: ToolResultBudgetArtifact;
  reason: "single_result" | "aggregate_message";
};

export type ToolResultBudgetResult = {
  messages: ModelMessage[];
  records: ToolResultBudgetRecord[];
};

const TOOL_RESULTS_DIR = "tool-results";
const TOOL_RESULT_PREVIEW_CHARS = 2_000;

type Candidate = {
  messageIndex: number;
  toolUseId: string;
  content: string;
  chars: number;
  bytes: number;
};

export async function applyToolResultBudgetToMessages(
  messages: ModelMessage[],
  options: {
    projectPath: string;
    sessionId: string;
    now?: Date;
  },
): Promise<ToolResultBudgetResult> {
  const candidates = collectToolResultCandidates(messages);
  if (candidates.length === 0) return { messages, records: [] };

  const selected = new Map<string, Candidate & { reason: ToolResultBudgetRecord["reason"] }>();
  for (const candidate of candidates) {
    if (
      candidate.chars > LINGHUN_DEFAULT_TOOL_RESULT_CHARS ||
      candidate.bytes > LINGHUN_MAX_TOOL_RESULT_BYTES
    ) {
      selected.set(candidate.toolUseId, { ...candidate, reason: "single_result" });
    }
  }

  for (const group of groupCandidatesByAssistantToolUse(messages, candidates)) {
    const visibleSize = group.reduce((sum, candidate) => sum + candidate.chars, 0);
    if (visibleSize <= LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS) continue;
    let remaining = visibleSize;
    for (const candidate of [...group].sort((a, b) => b.chars - a.chars)) {
      if (remaining <= LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS) break;
      if (!selected.has(candidate.toolUseId)) {
        selected.set(candidate.toolUseId, { ...candidate, reason: "aggregate_message" });
      }
      remaining -= candidate.chars;
    }
  }

  if (selected.size === 0) return { messages, records: [] };

  const replacements = new Map<string, string>();
  const records: ToolResultBudgetRecord[] = [];
  for (const candidate of selected.values()) {
    const artifact = await writeToolResultArtifact(candidate, options);
    const replacement = buildToolResultBudgetSummary(artifact, candidate.reason);
    replacements.set(candidate.toolUseId, replacement);
    records.push({
      toolUseId: candidate.toolUseId,
      originalChars: candidate.content.length,
      replacementChars: replacement.length,
      artifact,
      reason: candidate.reason,
    });
  }

  return {
    messages: replaceToolResults(messages, replacements),
    records,
  };
}

function collectToolResultCandidates(messages: ModelMessage[]): Candidate[] {
  const candidates: Candidate[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== "tool") return;
    if (isBudgetSummary(message.content)) return;
    const bytes = Buffer.byteLength(message.content, "utf8");
    candidates.push({
      messageIndex,
      toolUseId: message.tool_call_id,
      content: message.content,
      chars: message.content.length,
      bytes,
    });
  });
  return candidates;
}

function groupCandidatesByAssistantToolUse(
  messages: ModelMessage[],
  candidates: Candidate[],
): Candidate[][] {
  const byMessageIndex = new Map(
    candidates.map((candidate) => [candidate.messageIndex, candidate]),
  );
  const groups: Candidate[][] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.toolCalls?.length) continue;
    const ids = new Set(message.toolCalls.map((toolCall) => toolCall.id));
    const group: Candidate[] = [];
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const next = messages[cursor];
      if (next.role === "assistant") break;
      if (next.role !== "tool") continue;
      if (!ids.has(next.tool_call_id)) continue;
      const candidate = byMessageIndex.get(cursor);
      if (candidate) group.push(candidate);
    }
    if (group.length > 0) groups.push(group);
  }
  return groups;
}

async function writeToolResultArtifact(
  candidate: Candidate,
  options: { projectPath: string; sessionId: string; now?: Date },
): Promise<ToolResultBudgetArtifact> {
  const now = options.now ?? new Date();
  const dir = join(options.projectPath, ".linghun", "session", TOOL_RESULTS_DIR, options.sessionId);
  await mkdir(dir, { recursive: true });
  const sha256 = createHash("sha256").update(candidate.content).digest("hex");
  const safeId = sanitizeId(candidate.toolUseId) || randomUUID();
  const artifactId = `${safeId}-${sha256.slice(0, 12)}`;
  const path = join(dir, `${artifactId}.txt`);
  await writeFile(path, candidate.content, { encoding: "utf8", flag: "wx" }).catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    },
  );
  const relativePath = relative(options.projectPath, path).replace(/\\/g, "/");
  const preview = candidate.content.slice(0, TOOL_RESULT_PREVIEW_CHARS);
  return {
    id: artifactId,
    toolUseId: candidate.toolUseId,
    path,
    relativePath,
    bytes: candidate.bytes,
    chars: candidate.content.length,
    sha256,
    previewChars: preview.length,
    preview,
    hasMore: preview.length < candidate.content.length,
  };
}

function buildToolResultBudgetSummary(
  artifact: ToolResultBudgetArtifact,
  reason: ToolResultBudgetRecord["reason"],
): string {
  return [
    "<persisted-tool-result>",
    `reason: ${reason}`,
    `toolUseId: ${artifact.toolUseId}`,
    `artifactId: ${artifact.id}`,
    `artifactPath: ${artifact.relativePath}`,
    `originalChars: ${artifact.chars}`,
    `originalBytes: ${artifact.bytes}`,
    `sha256: ${artifact.sha256}`,
    `previewChars: ${artifact.previewChars}`,
    "read: use /details output with the evidence id or read the artifact path if you need the full tool output.",
    "preview:",
    artifact.preview,
    artifact.hasMore ? "..." : "",
    "</persisted-tool-result>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function replaceToolResults(
  messages: ModelMessage[],
  replacements: ReadonlyMap<string, string>,
): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "tool") return message;
    const replacement = replacements.get(message.tool_call_id);
    return replacement ? { ...message, content: replacement } : message;
  });
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/gu, "-").slice(0, 64);
}

function isBudgetSummary(content: string): boolean {
  return content.startsWith("<persisted-tool-result>");
}

export function formatToolResultBudgetEvidenceSummary(record: ToolResultBudgetRecord): string {
  return `tool_result persisted artifact=${record.artifact.relativePath} toolUseId=${record.toolUseId} chars=${record.originalChars} bytes=${record.artifact.bytes} sha256=${record.artifact.sha256}`;
}

export function formatToolResultBudgetSystemEvent(record: ToolResultBudgetRecord): string {
  return `tool_result_budget_persisted evidence artifact=${basename(record.artifact.path)} toolUseId=${record.toolUseId} reason=${record.reason} chars=${record.originalChars} sha256=${record.artifact.sha256}`;
}
