import { randomUUID } from "node:crypto";
import type { ModelMessage } from "@linghun/providers";
import { stableHash } from "./cache-freshness.js";
import {
  bytesPerTokenForFileType,
  estimateToolCallsCharsLocal,
  estimateValueChars,
} from "./context-estimator.js";

export type CompactKind = "micro" | "manual" | "auto-suggested";

export type CompactBoundary = {
  id: string;
  kind: CompactKind;
  createdAt: string;
  preCompactTokenEstimate?: number;
  postCompactTokenEstimate?: number;
  compactedToolResultIds: string[];
  preservedEvidenceRefs: string[];
  preservedFiles: string[];
  handoffPacketId?: string;
};

export type CompactResult = {
  messages: ModelMessage[];
  boundary: CompactBoundary | null;
  changed: boolean;
};

export type MicroCompactOptions = {
  maxChars: number;
  preserveRecentMessages?: number;
  kind?: CompactKind;
};

const DEFAULT_PRESERVE_RECENT_MESSAGES = 6;
const COMPACT_SUMMARY_LIMIT = 240;

export function microCompactMessages(
  messages: ModelMessage[],
  options: MicroCompactOptions,
): CompactResult {
  const maxChars = Math.max(0, options.maxChars);
  if (estimateModelMessagesChars(messages) <= maxChars) {
    return { messages, boundary: null, changed: false };
  }

  const groups = groupMessagesWithoutSplittingToolPairs(messages);
  const keepRecent = Math.max(
    0,
    options.preserveRecentMessages ?? DEFAULT_PRESERVE_RECENT_MESSAGES,
  );

  // Walk groups in reverse, tracking which groups to keep (avoids O(n²) unshift)
  const keepFromIndex = (() => {
    let accumulatedChars = 0;
    let accumulatedMessages = 0;
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const group = groups[i];
      if (!group) continue;
      const groupChars = estimateModelMessagesChars(group.messages);
      if (accumulatedMessages >= keepRecent && accumulatedChars + groupChars > maxChars) {
        return i + 1;
      }
      accumulatedChars += groupChars;
      accumulatedMessages += group.messages.length;
    }
    return 0;
  })();

  // Flatten kept groups in forward order
  const selected: ModelMessage[] = [];
  for (let i = keepFromIndex; i < groups.length; i += 1) {
    const group = groups[i];
    if (!group) continue;
    for (const msg of group.messages) {
      selected.push(msg);
    }
  }

  const firstConversationIndex = messages.findIndex((message) => message.role !== "system");
  const leadingSystemMessages = messages.slice(
    0,
    firstConversationIndex === -1 ? messages.length : firstConversationIndex,
  );
  const selectedSet = new Set(selected);
  const finalMessages = [
    ...leadingSystemMessages.filter((message) => !selectedSet.has(message)),
    ...selected,
  ];

  // Use a Set for O(1) membership check instead of O(n×m) includes
  const finalSet = new Set(finalMessages);
  const removed = messages.filter((message) => !finalSet.has(message));
  const preservedEvidenceRefs = collectEvidenceRefs(finalMessages);
  const compactedToolResultIds = removed
    .filter(
      (message): message is Extract<ModelMessage, { role: "tool" }> => message.role === "tool",
    )
    .map((message) => message.tool_call_id);
  const boundary: CompactBoundary = {
    id: randomUUID(),
    kind: options.kind ?? "micro",
    createdAt: new Date().toISOString(),
    preCompactTokenEstimate: estimateTokensFromChars(estimateModelMessagesChars(messages)),
    postCompactTokenEstimate: estimateTokensFromChars(estimateModelMessagesChars(finalMessages)),
    compactedToolResultIds,
    preservedEvidenceRefs,
    preservedFiles: collectFileRefs(finalMessages),
  };

  return { messages: finalMessages, boundary, changed: true };
}

export function compactMessagesToFit(
  messages: ModelMessage[],
  options: MicroCompactOptions,
): CompactResult {
  const first = microCompactMessages(messages, options);
  if (estimateModelMessagesChars(first.messages) <= Math.max(0, options.maxChars)) {
    return first;
  }

  return microCompactMessages(first.messages, {
    ...options,
    preserveRecentMessages: 1,
    kind: options.kind ?? "micro",
  });
}

export function createManualCompactBoundary(input: {
  preCompactChars: number;
  postCompactChars: number;
  preservedEvidenceRefs?: string[];
  preservedFiles?: string[];
  handoffPacketId?: string;
}): CompactBoundary {
  return {
    id: randomUUID(),
    kind: "manual",
    createdAt: new Date().toISOString(),
    preCompactTokenEstimate: estimateTokensFromChars(input.preCompactChars),
    postCompactTokenEstimate: estimateTokensFromChars(input.postCompactChars),
    compactedToolResultIds: [],
    preservedEvidenceRefs: sanitizeRefs(input.preservedEvidenceRefs ?? []),
    preservedFiles: sanitizeRefs(input.preservedFiles ?? []),
    handoffPacketId: input.handoffPacketId,
  };
}

export function compactBoundaryHash(boundaries: CompactBoundary[]): string {
  return stableHash(
    boundaries.map((boundary) => ({
      id: boundary.id,
      kind: boundary.kind,
      createdAt: boundary.createdAt,
      pre: boundary.preCompactTokenEstimate,
      post: boundary.postCompactTokenEstimate,
      evidence: boundary.preservedEvidenceRefs,
      files: boundary.preservedFiles,
    })),
  );
}

export function estimateModelMessagesChars(messages: ModelMessage[]): number {
  return messages.reduce((total, message) => {
    if (message.role === "assistant") {
      return total + message.content.length + estimateToolCallsCharsLocal(message.toolCalls);
    }
    return total + message.content.length;
  }, 0);
}

type MessageGroup = { messages: ModelMessage[] };

function groupMessagesWithoutSplittingToolPairs(messages: ModelMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (message?.role === "assistant" && message.toolCalls?.length) {
      const group: ModelMessage[] = [message];
      const expected = new Set(message.toolCalls.map((toolCall) => toolCall.id));
      let cursor = index + 1;
      while (cursor < messages.length) {
        const next = messages[cursor];
        if (next?.role !== "tool" || !expected.has(next.tool_call_id)) {
          break;
        }
        group.push(next);
        expected.delete(next.tool_call_id);
        cursor += 1;
      }
      groups.push({ messages: expected.size === 0 ? group : [] });
      index = cursor;
      continue;
    }
    if (message?.role === "tool") {
      groups.push({ messages: [] });
      index += 1;
      continue;
    }
    if (message) {
      groups.push({ messages: [message] });
    }
    index += 1;
  }
  return groups;
}

function collectEvidenceRefs(messages: ModelMessage[]): string[] {
  const refs = new Set<string>();
  for (const message of messages) {
    const matches = message.content.matchAll(/"evidenceId"\s*:\s*"([^"]+)"/g);
    for (const match of matches) {
      refs.add(match[1] ?? "");
    }
  }
  return sanitizeRefs([...refs].filter(Boolean));
}

function collectFileRefs(messages: ModelMessage[]): string[] {
  const refs = new Set<string>();
  for (const message of messages) {
    const matches = message.content.matchAll(
      /"?(?:path|file|source)"?\s*[:=]\s*["']?([^"'\s,}]{1,160})/g,
    );
    for (const match of matches) {
      const value = match[1] ?? "";
      if (value.includes("/") || value.includes(".")) {
        refs.add(value);
      }
    }
  }
  return sanitizeRefs([...refs]);
}

function sanitizeRefs(refs: string[]): string[] {
  return refs
    .map((ref) => truncateText(ref.replace(/\s+/g, " "), COMPACT_SUMMARY_LIMIT))
    .slice(0, 20);
}

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / bytesPerTokenForFileType(""));
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
