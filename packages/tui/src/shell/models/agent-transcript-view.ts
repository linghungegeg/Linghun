import type { TranscriptEvent } from "@linghun/core";
import type { Language } from "@linghun/shared";
import type { ProductBlockViewModel } from "../types.js";
import { createUserTextBlock } from "./command-transcript-presenter.js";

export const AGENT_TRANSCRIPT_EVENT_LIMIT = 160;

export function transcriptEventsToAgentBlocks(
  events: TranscriptEvent[],
  language: Language,
): ProductBlockViewModel[] {
  const blocks: ProductBlockViewModel[] = [];
  for (const [index, event] of events.entries()) {
    if (event.type === "user_message") {
      blocks.push({
        ...createUserTextBlock(index, event.text, Date.parse(event.createdAt)),
        id: `agent-view:user:${event.id}`,
      });
      continue;
    }
    if (event.type === "assistant_text_delta") {
      blocks.push({
        id: `agent-view:assistant:${event.id}`,
        kind: "details",
        status: "info",
        title: "",
        summary: firstLine(event.text),
        fullText: event.text,
        messageKind: "assistant_text",
        keep: true,
      });
      continue;
    }
    if (event.type === "tool_call_start") {
      const input = formatToolInput(event.input);
      blocks.push({
        id: `agent-view:tool-call:${event.id}`,
        kind: "tool",
        status: "running",
        title: `${event.name}(${input})`,
        summary: `${event.name}(${input})`,
        fullText: `${event.name}(${input})`,
        messageKind: "tool_call",
        keep: true,
      });
      continue;
    }
    if (event.type === "tool_result") {
      const text = formatToolResult(event);
      blocks.push({
        id: `agent-view:tool-result:${event.toolUseId}`,
        kind: event.isError ? "error" : "details",
        status: event.isError ? "fail" : "info",
        title: event.toolName,
        summary: text,
        fullText: text,
        messageKind: event.isError ? "tool_result_error" : "tool_result_success",
        displayBlock: {
          kind: event.isError ? "tool_result_error" : "tool_result_success",
          title: event.toolName,
          status: event.isError ? "error" : "success",
          summary: text,
          body: text,
          bordered: event.isError,
        },
        keep: true,
      });
    }
  }
  return blocks;
}

function formatToolInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return input.slice(0, 120);
  try {
    return JSON.stringify(input).slice(0, 120);
  } catch {
    return String(input).slice(0, 120);
  }
}

function formatToolResult(event: Extract<TranscriptEvent, { type: "tool_result" }>): string {
  const content = typeof event.content === "string" ? event.content : JSON.stringify(event.content);
  const head = event.isError ? `${event.toolName} · Command failed` : `${event.toolName} · Result`;
  return `${head}\n${content ?? ""}`.trim();
}

function firstLine(text: string): string {
  return text.replace(/\r/g, "").split("\n").find((line) => line.trim())?.trim() ?? "";
}
