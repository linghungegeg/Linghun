import type { ProductBlockViewModel } from "../types.js";

export type TranscriptSourceCellKind =
  | "assistant"
  | "user"
  | "command"
  | "diagnostic"
  | "local_command_output"
  | "tool_result_success"
  | "tool_result_error"
  | "compact_boundary";

export type TranscriptSourceCell = {
  id: string;
  kind: TranscriptSourceCellKind;
  block: ProductBlockViewModel;
  rawText?: string;
  streamContinuation?: boolean;
};

export type TranscriptSource = {
  cells: TranscriptSourceCell[];
};

export function createTranscriptSource(): TranscriptSource {
  return { cells: [] };
}

export function appendTranscriptSourceCell(
  source: TranscriptSource,
  cell: TranscriptSourceCell,
): void {
  source.cells.push({
    ...cell,
    block: cloneTranscriptSourceBlock(cell.block),
  });
}

export function upsertTranscriptSourceCell(
  source: TranscriptSource,
  cell: TranscriptSourceCell,
): void {
  const index = source.cells.findIndex((candidate) => candidate.id === cell.id);
  const next = {
    ...cell,
    block: cloneTranscriptSourceBlock(cell.block),
  };
  if (index >= 0) {
    const previous = source.cells[index];
    source.cells[index] = {
      ...next,
      rawText: shouldKeepPreviousRawText(previous?.rawText, cell.rawText, cell.block.fullText)
        ? previous?.rawText
        : cell.rawText,
    };
    return;
  }
  source.cells.push(next);
}

export function clearTranscriptSource(source: TranscriptSource): void {
  source.cells.splice(0, source.cells.length);
}

export function snapshotTranscriptSourceCells(source: TranscriptSource): TranscriptSourceCell[] {
  return source.cells.map((cell) => ({
    ...cell,
    block: cloneTranscriptSourceBlock(cell.block),
  }));
}

export function findTranscriptSourceCell(
  source: TranscriptSource,
  id: string,
): TranscriptSourceCell | undefined {
  const cell = source.cells.find((candidate) => candidate.id === id);
  return cell
    ? {
        ...cell,
        block: { ...cell.block },
      }
    : undefined;
}

export function transcriptSourceToBlocks(source: TranscriptSource): ProductBlockViewModel[] {
  return snapshotTranscriptSourceCells(source).map((cell) => cell.block);
}

export function transcriptSourceRawTextForBlock(block: ProductBlockViewModel): string | undefined {
  if (block.kind === "command" && !block.messageKind) return block.title;
  switch (block.messageKind) {
    case "assistant_text":
    case "user_text":
    case "diagnostic":
    case "local_command_output":
    case "tool_result_success":
    case "tool_result_error":
      return block.fullText ?? block.summary ?? block.title;
    default:
      return undefined;
  }
}

function shouldKeepPreviousRawText(
  previous: string | undefined,
  next: string | undefined,
  nextBlockText: string | undefined,
): boolean {
  if (!previous || next) return false;
  return !isCompactedTranscriptText(nextBlockText);
}

function cloneTranscriptSourceBlock(block: ProductBlockViewModel): ProductBlockViewModel {
  return { ...block };
}

function isCompactedTranscriptText(value: string | undefined): boolean {
  return Boolean(
    value &&
      (value.startsWith("<persisted-tui-output>") ||
        value.startsWith("<compacted-tui-output>") ||
        value.startsWith("<persisted-tui-block-output>") ||
        value.startsWith("<compacted-tui-block-output>")),
  );
}

export function transcriptSourceKindForBlock(
  block: ProductBlockViewModel,
): TranscriptSourceCellKind | undefined {
  if (block.kind === "command" && !block.messageKind) return "command";
  switch (block.messageKind) {
    case "assistant_text":
      return "assistant";
    case "user_text":
      return "user";
    case "diagnostic":
      return "diagnostic";
    case "local_command_output":
      return "local_command_output";
    case "tool_result_success":
      return "tool_result_success";
    case "tool_result_error":
      return "tool_result_error";
    case "compact_boundary":
      return "compact_boundary";
    default:
      return undefined;
  }
}
