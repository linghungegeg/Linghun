import { createHash, randomUUID } from "node:crypto";
import type { ModelMessage } from "@linghun/providers";

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

  const system = messages[0]?.role === "system" ? messages[0] : undefined;
  const finalMessages = system && selected[0] !== system ? [system, ...selected] : selected;

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
      return total + message.content.length + estimateToolCallsChars(message.toolCalls);
    }
    return total + message.content.length;
  }, 0);
}

/** Lightweight size estimate for toolCalls array without full JSON.stringify allocation. */
function estimateToolCallsChars(
  toolCalls: Array<{ id: string; name: string; input: unknown }> | undefined,
): number {
  if (!toolCalls || toolCalls.length === 0) return 2; // "[]"
  let size = 2; // brackets
  for (const call of toolCalls) {
    // {"id":"...","name":"...","input":...} + comma
    size += call.id.length + call.name.length + 24; // fixed overhead: keys, quotes, braces, colons
    size += estimateInputChars(call.input);
  }
  return size;
}

function estimateInputChars(value: unknown, depth = 0): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === "string") return value.length + 2;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (depth > 6) return 16;
  if (Array.isArray(value)) {
    let s = 2;
    for (const item of value) {
      s += estimateInputChars(item, depth + 1) + 1;
    }
    return s;
  }
  if (typeof value === "object") {
    let s = 2;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      s +=
        key.length + 3 + estimateInputChars((value as Record<string, unknown>)[key], depth + 1) + 1;
    }
    return s;
  }
  return 8;
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
  return Math.ceil(chars / 4);
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 12);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${key}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}
