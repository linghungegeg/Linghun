import {
  isTerminalSelectionMouseInput,
  isTerminalSelectionStale,
  parseTerminalSelectionMouseEvent,
  reduceTerminalSelection,
  terminalSelectedTextFromRows,
  terminalSelectionContainsRow,
  terminalSelectionLineIndexesForBlock,
  terminalSelectionLineRangesForBlock,
  type TerminalSelectionCell,
  type TerminalSelectionLineRange,
  type TerminalSelectionMouseAction,
  type TerminalSelectionMouseButton,
  type TerminalSelectionMouseEvent,
  type TerminalSelectionPoint,
  type TerminalSelectionState,
  type TerminalSelectionTextRow,
  type TerminalSelectionViewportGeometry,
} from "@linghun/ink-runtime";
import type { ProductBlockSelectionRange, ProductBlockViewModel, TranscriptScrollView } from "../types.js";
import { charWidth } from "../text-utils.js";

export type TranscriptMouseButton = TerminalSelectionMouseButton;
export type TranscriptMouseAction = TerminalSelectionMouseAction;
export type TranscriptMouseEvent = TerminalSelectionMouseEvent;
export type TranscriptViewportGeometry = TerminalSelectionViewportGeometry;
export type TranscriptTextRow = TerminalSelectionTextRow;
export type TranscriptScreenCell = TerminalSelectionCell;

export type TranscriptScreenBuffer = {
  rows: TranscriptTextRow[];
  width: number;
};

export type TranscriptSelectionPoint = TerminalSelectionPoint;
export type TranscriptSelectionState = TerminalSelectionState;

export type TranscriptSelectionInput = {
  state: TranscriptSelectionState | undefined;
  event: TranscriptMouseEvent;
  rows: TranscriptTextRow[];
  geometry?: TranscriptViewportGeometry;
  scroll?: TranscriptScrollView;
  copyOnSelect?: boolean;
};

export type TranscriptSelectionResult = {
  state: TranscriptSelectionState | undefined;
  copyText?: string;
  scrollDelta?: number;
  consumed: boolean;
};

export function buildTranscriptScreenBuffer(
  blocks: ProductBlockViewModel[],
  width = Number.POSITIVE_INFINITY,
): TranscriptScreenBuffer {
  const rows: TranscriptTextRow[] = [];
  for (const block of blocks) {
    const noSelect = isNoSelectBlock(block);
    const body = screenTextForBlock(block);
    const lines = body.replace(/\r/g, "").split("\n");
    for (let lineInBlock = 0; lineInBlock < lines.length; lineInBlock++) {
      appendScreenRows(rows, {
        blockId: block.id,
        lineInBlock,
        text: lines[lineInBlock] ?? "",
        width,
        noSelect,
      });
    }
    if (body.trim().length > 0) appendScreenRows(rows, { text: "", width, noSelect: true });
  }
  if (rows.length > 0 && rows.at(-1)?.text === "") rows.pop();
  return { rows, width };
}

export function buildTranscriptTextRows(
  blocks: ProductBlockViewModel[],
  width = Number.POSITIVE_INFINITY,
): TranscriptTextRow[] {
  return buildTranscriptScreenBuffer(blocks, width).rows;
}

export function parseSgrMouseEvent(input: string): TranscriptMouseEvent | undefined {
  return parseTerminalSelectionMouseEvent(input);
}

export function isSgrMouseInput(input: string): boolean {
  return isTerminalSelectionMouseInput(input);
}

export function isSelectionStale(state: TranscriptSelectionState | undefined, now: number): boolean {
  return isTerminalSelectionStale(state, now);
}

export function reduceTranscriptSelection(input: TranscriptSelectionInput): TranscriptSelectionResult {
  return reduceTerminalSelection(input);
}

export function selectionContainsRow(
  selection: TranscriptSelectionState | undefined,
  rowIndex: number,
): boolean {
  return terminalSelectionContainsRow(selection, rowIndex);
}

export function selectionLineIndexesForBlock(
  selection: TranscriptSelectionState | undefined,
  rows: TranscriptTextRow[],
  blockId: string,
): number[] {
  return terminalSelectionLineIndexesForBlock(selection, rows, blockId);
}

export function selectionLineRangesForBlock(
  selection: TranscriptSelectionState | undefined,
  rows: TranscriptTextRow[],
  blockId: string,
): ProductBlockSelectionRange[] {
  return terminalSelectionLineRangesForBlock(selection, rows, blockId).map(toProductBlockSelectionRange);
}

export function selectedTextFromRows(
  rows: TranscriptTextRow[],
  anchor: TranscriptSelectionPoint,
  focus: TranscriptSelectionPoint,
): string {
  return terminalSelectedTextFromRows(rows, anchor, focus);
}

function toProductBlockSelectionRange(range: TerminalSelectionLineRange): ProductBlockSelectionRange {
  return {
    lineIndex: range.lineIndex,
    startColumn: range.startColumn,
    endColumn: range.endColumn,
  };
}

function screenTextForBlock(block: ProductBlockViewModel): string {
  if (block.messageKind === "user_text") return block.fullText ?? block.title ?? "";
  return block.fullText ?? block.summary ?? block.title ?? "";
}

function isNoSelectBlock(block: ProductBlockViewModel): boolean {
  if (block.messageKind === "command_transcript" || block.messageKind === "status") return true;
  if (block.kind === "home" || block.kind === "setup" || block.kind === "permission") return true;
  return false;
}

function appendScreenRows(
  rows: TranscriptTextRow[],
  input: {
    text: string;
    width: number;
    blockId?: string;
    lineInBlock?: number;
    noSelect?: boolean;
  },
): void {
  const wrapWidth = Number.isFinite(input.width) ? Math.max(1, Math.floor(input.width)) : Infinity;
  const sourceCells = cellsFromText(input.text, input.noSelect === true);
  if (sourceCells.length === 0) {
    rows.push({
      index: rows.length,
      blockId: input.blockId,
      lineInBlock: input.lineInBlock,
      text: "",
      cells: [],
      noSelect: input.noSelect,
    });
    return;
  }
  let current: TranscriptScreenCell[] = [];
  let currentWidth = 0;
  let sourceColumnStart = 0;
  let softWrapped = false;
  for (const cell of sourceCells) {
    const nextWidth = Math.max(1, cell.width);
    if (current.length > 0 && currentWidth + nextWidth > wrapWidth) {
      rows.push(createScreenRow(rows.length, input, current, softWrapped, sourceColumnStart));
      sourceColumnStart += current.length;
      current = [];
      currentWidth = 0;
      softWrapped = true;
    }
    current.push(cell);
    currentWidth += nextWidth;
  }
  rows.push(createScreenRow(rows.length, input, current, softWrapped, sourceColumnStart));
}

function createScreenRow(
  index: number,
  input: {
    blockId?: string;
    lineInBlock?: number;
    noSelect?: boolean;
  },
  cells: TranscriptScreenCell[],
  softWrapped: boolean,
  sourceColumnStart: number,
): TranscriptTextRow {
  return {
    index,
    blockId: input.blockId,
    lineInBlock: input.lineInBlock,
    text: cells.map((cell) => cell.selectableText).join(""),
    cells,
    sourceColumnStart,
    softWrapped,
    noSelect: input.noSelect,
  };
}

function cellsFromText(text: string, noSelect: boolean): TranscriptScreenCell[] {
  const cells: TranscriptScreenCell[] = [];
  for (const char of Array.from(text)) {
    const width = Math.max(1, charWidth(char));
    cells.push({ char, selectableText: noSelect ? "" : char, width, noSelect });
    for (let index = 1; index < width; index++) {
      cells.push({ char: "", selectableText: "", width: 0, noSelect: true });
    }
  }
  return cells;
}
