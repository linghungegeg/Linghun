import { extname } from "node:path";
import type { TranscriptEvent } from "@linghun/core";
import type { ModelMessage } from "@linghun/providers";

const DEFAULT_BYTES_PER_TOKEN = 4;

const FILE_TYPE_BYTES_PER_TOKEN: Record<string, number> = {
  ".json": 2,
  ".jsonl": 2,
};

export function bytesPerTokenForFileType(fileExt: string | undefined): number {
  const normalized = normalizeFileExt(fileExt);
  return FILE_TYPE_BYTES_PER_TOKEN[normalized] ?? DEFAULT_BYTES_PER_TOKEN;
}

export function estimateTokensFromBytesForFileType(
  bytes: number,
  fileExt: string | undefined,
): number {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  return Math.max(1, Math.ceil(safeBytes / bytesPerTokenForFileType(fileExt)));
}

export function estimateFileTokens(filePath: string, bytes: number): number {
  return estimateTokensFromBytesForFileType(bytes, extname(filePath));
}

function normalizeFileExt(fileExt: string | undefined): string {
  const trimmed = (fileExt ?? "").trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

/**
 * Lightweight character count estimator for arbitrary values.
 * Avoids full JSON.stringify allocation when only an approximate length is needed.
 * Uses a conservative approximation for context-budget checks; exact JSON size is intentionally not computed on the hot path.
 */
export function estimateValueChars(value: unknown, depth = 0): number {
  if (value === null || value === undefined) return 4; // "null"
  if (typeof value === "string") return value.length + 2; // quotes
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (depth > 8) return 16; // safety cap for deeply nested structures
  if (Array.isArray(value)) {
    let size = 2; // brackets
    for (const item of value) {
      size += estimateValueChars(item, depth + 1) + 1; // +1 for comma
    }
    return size;
  }
  if (typeof value === "object") {
    let size = 2; // braces
    for (const key of Object.keys(value as Record<string, unknown>)) {
      size += key.length + 3; // key + quotes + colon
      size += estimateValueChars((value as Record<string, unknown>)[key], depth + 1) + 1;
    }
    return size;
  }
  return 8; // fallback for symbols, functions, etc.
}

export function stringifyValueWithinBudget(value: unknown, maxChars: number): string | null {
  const budget = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
  const writer = new BoundedJsonWriter(budget);
  writer.writeValue(value);
  return writer.result();
}

class BoundedJsonWriter {
  private output = "";
  private truncated = false;
  private readonly seen = new WeakSet<object>();

  constructor(private readonly maxChars: number) {}

  result(): string | null {
    if (!this.truncated) return this.output;
    const marker = "...[truncated]";
    if (this.maxChars <= marker.length) return marker.slice(0, this.maxChars);
    return `${this.output.slice(0, this.maxChars - marker.length)}${marker}`;
  }

  writeValue(value: unknown): void {
    if (this.truncated) return;
    if (value === null) {
      this.append("null");
      return;
    }
    switch (typeof value) {
      case "string":
        this.writeString(value);
        return;
      case "number":
      case "boolean":
        this.append(JSON.stringify(value));
        return;
      case "bigint":
        this.writeString(String(value));
        return;
      case "undefined":
      case "function":
      case "symbol":
        this.append("null");
        return;
      case "object":
        if (this.seen.has(value)) {
          this.append('"[Circular]"');
          return;
        }
        this.seen.add(value);
        if (Array.isArray(value)) {
          this.writeArray(value);
        } else {
          this.writeObject(value as Record<string, unknown>);
        }
        this.seen.delete(value);
    }
  }

  private writeArray(values: unknown[]): void {
    this.append("[");
    for (let index = 0; index < values.length; index += 1) {
      if (index > 0) this.append(",");
      this.writeValue(values[index]);
      if (this.truncated) return;
    }
    this.append("]");
  }

  private writeObject(record: Record<string, unknown>): void {
    this.append("{");
    const entries = Object.entries(record);
    entries.forEach(([key, value], index) => {
      if (index > 0) this.append(",");
      this.writeString(key);
      this.append(":");
      this.writeValue(value);
    });
    this.append("}");
  }

  private writeString(value: string): void {
    this.append('"');
    for (let index = 0; index < value.length; index += 1) {
      if (this.truncated) return;
      const char = value[index] ?? "";
      switch (char) {
        case '"':
          this.append('\\"');
          break;
        case "\\":
          this.append("\\\\");
          break;
        case "\b":
          this.append("\\b");
          break;
        case "\f":
          this.append("\\f");
          break;
        case "\n":
          this.append("\\n");
          break;
        case "\r":
          this.append("\\r");
          break;
        case "\t":
          this.append("\\t");
          break;
        default:
          this.append(char < " " ? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}` : char);
      }
    }
    this.append('"');
  }

  private append(text: string): void {
    if (this.truncated) return;
    if (this.output.length + text.length <= this.maxChars) {
      this.output += text;
      return;
    }
    const remaining = Math.max(0, this.maxChars - this.output.length);
    this.output += text.slice(0, remaining);
    this.truncated = true;
  }
}

/** Lightweight toolCalls size estimate — avoids JSON.stringify allocation on budget hot path. */
export function estimateToolCallsCharsLocal(
  toolCalls: Array<{ id: string; name: string; input: unknown }> | undefined,
): number {
  if (!toolCalls || toolCalls.length === 0) return 2; // "[]"
  let size = 2; // brackets
  for (const call of toolCalls) {
    // Conservative: id + name + fixed JSON overhead (keys, quotes, braces, colons, comma)
    size += call.id.length + call.name.length + 28;
    size += estimateValueChars(call.input);
  }
  return size;
}

export function estimateModelMessageChars(messages: ModelMessage[]): number {
  return messages.reduce((total, message) => {
    if (message.role === "assistant") {
      return total + message.content.length + estimateToolCallsCharsLocal(message.toolCalls);
    }
    return total + message.content.length;
  }, 0);
}

export function estimateTranscriptContextChars(transcript: TranscriptEvent[]): number {
  return transcript.reduce((total, event) => {
    if (event.type === "user_message") return total + event.text.length;
    if (event.type === "assistant_text_delta") return total + event.text.length;
    if (event.type === "tool_call_start") return total + estimateValueChars(event.input);
    if (event.type === "tool_result") return total + estimateValueChars(event.content);
    return total;
  }, 0);
}
