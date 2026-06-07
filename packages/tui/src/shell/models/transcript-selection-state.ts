import type {
  ProductBlockSelectionRange,
  ProductBlockViewModel,
  TranscriptScrollView,
} from "../types.js";
import { charWidth } from "../text-utils.js";

export type TranscriptMouseButton = "left" | "wheel-up" | "wheel-down" | "other";

export type TranscriptMouseAction = "down" | "drag" | "up" | "wheel";

export type TranscriptMouseEvent = {
  x: number;
  y: number;
  button: TranscriptMouseButton;
  action: TranscriptMouseAction;
};

export type TranscriptViewportGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  contentHeight: number;
  topOffset: number;
};

export type TranscriptTextRow = {
  index: number;
  blockId?: string;
  lineInBlock?: number;
  text: string;
  cells: TranscriptScreenCell[];
  sourceColumnStart?: number;
  softWrapped?: boolean;
  noSelect?: boolean;
};

export type TranscriptScreenCell = {
  char: string;
  selectableText: string;
  width: number;
  noSelect?: boolean;
};

export type TranscriptScreenBuffer = {
  rows: TranscriptTextRow[];
  width: number;
};

export type TranscriptSelectionPoint = {
  row: number;
  column: number;
};

export type TranscriptSelectionState = {
  dragging: boolean;
  anchor?: TranscriptSelectionPoint;
  focus?: TranscriptSelectionPoint;
  selectedText?: string;
  copiedText?: string;
  lastCopyError?: string;
};

export type TranscriptSelectionInput = {
  state: TranscriptSelectionState | undefined;
  event: TranscriptMouseEvent;
  rows: TranscriptTextRow[];
  geometry?: TranscriptViewportGeometry;
  scroll?: TranscriptScrollView;
};

export type TranscriptSelectionResult = {
  state: TranscriptSelectionState | undefined;
  copyText?: string;
  scrollDelta?: number;
  consumed: boolean;
};

const EDGE_AUTOSCROLL_LINES = 2;
// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR mouse input may start with ESC.
const SGR_MOUSE_RE = /^\u001B?\[<(\d+);(\d+);(\d+)([mM])$/u;

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

export function parseSgrMouseEvent(input: string): TranscriptMouseEvent | undefined {
  const match = input.match(SGR_MOUSE_RE);
  if (!match) return undefined;
  const code = Number.parseInt(match[1] ?? "", 10);
  const x = Number.parseInt(match[2] ?? "", 10);
  const y = Number.parseInt(match[3] ?? "", 10);
  const suffix = match[4];
  if (!Number.isFinite(code) || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const action = actionFromCode(code, suffix === "m");
  return {
    x: Math.max(0, x - 1),
    y: Math.max(0, y - 1),
    button: buttonFromCode(code),
    action,
  };
}

export function isSgrMouseInput(input: string): boolean {
  return SGR_MOUSE_RE.test(input);
}

export function reduceTranscriptSelection(
  input: TranscriptSelectionInput,
): TranscriptSelectionResult {
  const { event, geometry, rows } = input;
  if (!geometry || rows.length === 0) return { state: input.state, consumed: false };
  if (event.button !== "left" && event.button !== "wheel-up" && event.button !== "wheel-down") {
    return { state: input.state, consumed: false };
  }
  if (event.action === "wheel") return { state: input.state, consumed: false };
  if (!isInsideTranscript(event, geometry)) {
    if (input.state?.dragging && (event.action === "drag" || event.action === "up")) {
      return finishOrUpdateOutOfBoundsDrag(input);
    }
    return { state: input.state, consumed: false };
  }

  const point = pointFromMouse(event, geometry, rows);
  const scrollDelta =
    event.action === "drag" && input.state?.dragging
      ? autoScrollDeltaForMouse(event.y, geometry, input.scroll)
      : 0;

  if (event.action === "down") {
    const next: TranscriptSelectionState = { dragging: true, anchor: point, focus: point };
    return { state: withSelectedText(next, rows), consumed: true };
  }

  if (event.action === "drag") {
    if (!input.state?.dragging || !input.state.anchor)
      return { state: input.state, consumed: true };
    const next: TranscriptSelectionState = {
      ...input.state,
      dragging: true,
      focus: point,
      lastCopyError: undefined,
    };
    return {
      state: withSelectedText(next, rows),
      scrollDelta,
      consumed: true,
    };
  }

  if (event.action === "up") {
    if (!input.state?.dragging || !input.state.anchor) return { state: undefined, consumed: true };
    const next = withSelectedText({ ...input.state, dragging: false, focus: point }, rows);
    const copyText = next.selectedText?.trimEnd();
    if (!copyText) return { state: undefined, consumed: true };
    return {
      state: { ...next, copiedText: copyText },
      copyText,
      consumed: true,
    };
  }

  return { state: input.state, consumed: false };
}

function finishOrUpdateOutOfBoundsDrag(input: TranscriptSelectionInput): TranscriptSelectionResult {
  const { event, geometry, rows } = input;
  if (!geometry || !input.state?.anchor || rows.length === 0) {
    return { state: undefined, consumed: true };
  }
  const point = pointFromMouse(event, geometry, rows);
  if (event.action === "drag") {
    const next = withSelectedText({ ...input.state, dragging: true, focus: point }, rows);
    return {
      state: next,
      scrollDelta: autoScrollDeltaForMouse(event.y, geometry, input.scroll),
      consumed: true,
    };
  }
  const next = withSelectedText({ ...input.state, dragging: false, focus: point }, rows);
  const copyText = next.selectedText?.trimEnd();
  if (!copyText) return { state: undefined, consumed: true };
  return {
    state: { ...next, copiedText: copyText },
    copyText,
    consumed: true,
  };
}

export function selectionContainsRow(
  selection: TranscriptSelectionState | undefined,
  rowIndex: number,
): boolean {
  if (!selection?.anchor || !selection.focus) return false;
  const range = orderedPoints(selection.anchor, selection.focus);
  return rowIndex >= range.start.row && rowIndex <= range.end.row;
}

export function selectionLineIndexesForBlock(
  selection: TranscriptSelectionState | undefined,
  rows: TranscriptTextRow[],
  blockId: string,
): number[] {
  if (!selection?.anchor || !selection.focus) return [];
  const selected = new Set<number>();
  for (const row of rows) {
    if (row.blockId !== blockId || row.lineInBlock === undefined) continue;
    if (row.noSelect) continue;
    if (selectionContainsRow(selection, row.index)) selected.add(row.lineInBlock);
  }
  return [...selected].sort((a, b) => a - b);
}

export function selectionLineRangesForBlock(
  selection: TranscriptSelectionState | undefined,
  rows: TranscriptTextRow[],
  blockId: string,
): ProductBlockSelectionRange[] {
  if (!selection?.anchor || !selection.focus) return [];
  const range = orderedPoints(selection.anchor, selection.focus);
  const selectedRows = rows.slice(range.start.row, range.end.row + 1);
  const ranges: ProductBlockSelectionRange[] = [];
  for (let index = 0; index < selectedRows.length; index++) {
    const row = selectedRows[index];
    if (!row || row.noSelect || row.blockId !== blockId || row.lineInBlock === undefined) continue;
    const start =
      selectedRows.length === 1 || index === 0 ? Math.max(0, range.start.column) : 0;
    const end =
      selectedRows.length === 1 || index === selectedRows.length - 1
        ? Math.max(start, range.end.column)
        : row.cells.length;
    if (end <= start) continue;
    const sourceColumnStart = row.sourceColumnStart ?? 0;
    ranges.push({
      lineIndex: row.lineInBlock,
      startColumn: sourceColumnStart + start,
      endColumn: sourceColumnStart + Math.min(end, row.cells.length),
    });
  }
  return ranges;
}

function withSelectedText(
  state: TranscriptSelectionState,
  rows: TranscriptTextRow[],
): TranscriptSelectionState {
  if (!state.anchor || !state.focus) return state;
  return { ...state, selectedText: selectedTextFromRows(rows, state.anchor, state.focus) };
}

export function selectedTextFromRows(
  rows: TranscriptTextRow[],
  anchor: TranscriptSelectionPoint,
  focus: TranscriptSelectionPoint,
): string {
  const range = orderedPoints(anchor, focus);
  const selected = rows.slice(range.start.row, range.end.row + 1);
  if (selected.length === 0) return "";
  const parts: string[] = [];
  for (let index = 0; index < selected.length; index++) {
    const row = selected[index];
    if (!row || row.noSelect) continue;
    const text =
      selected.length === 1
        ? sliceRowCells(row, range.start.column, range.end.column)
        : index === 0
          ? sliceRowCells(row, range.start.column, undefined)
          : index === selected.length - 1
            ? sliceRowCells(row, 0, range.end.column)
            : selectableTextFromRow(row);
    if (parts.length > 0 && !row.softWrapped) parts.push("\n");
    parts.push(text);
  }
  return parts.join("");
}

function orderedPoints(
  a: TranscriptSelectionPoint,
  b: TranscriptSelectionPoint,
): { start: TranscriptSelectionPoint; end: TranscriptSelectionPoint } {
  if (a.row < b.row) return { start: a, end: b };
  if (a.row > b.row) return { start: b, end: a };
  return a.column <= b.column ? { start: a, end: b } : { start: b, end: a };
}

function sliceRowCells(row: TranscriptTextRow, start: number, end: number | undefined): string {
  const cells = row.cells.length > 0 ? row.cells : cellsFromText(row.text, row.noSelect === true);
  return cells
    .slice(Math.max(0, start), end === undefined ? undefined : Math.max(0, end))
    .map((cell) => (cell.noSelect ? "" : cell.selectableText))
    .join("");
}

function selectableTextFromRow(row: TranscriptTextRow): string {
  return sliceRowCells(row, 0, undefined);
}

function pointFromMouse(
  event: TranscriptMouseEvent,
  geometry: TranscriptViewportGeometry,
  rows: TranscriptTextRow[],
): TranscriptSelectionPoint {
  const visibleRow = clamp(Math.floor(event.y - geometry.y), 0, Math.max(0, geometry.height - 1));
  const row = clamp(geometry.topOffset + visibleRow, 0, Math.max(0, rows.length - 1));
  const column = clamp(
    Math.floor(event.x - geometry.x),
    0,
    rows[row]?.cells.length ?? Array.from(rows[row]?.text ?? "").length,
  );
  return { row, column };
}

function autoScrollDeltaForMouse(
  y: number,
  geometry: TranscriptViewportGeometry,
  scroll: TranscriptScrollView | undefined,
): number {
  const maxOffset = Math.max(0, geometry.contentHeight - geometry.height);
  const current = scroll?.scrollOffset ?? 0;
  if (y < geometry.y && current < maxOffset) {
    return Math.min(EDGE_AUTOSCROLL_LINES, maxOffset - current);
  }
  if (y >= geometry.y + geometry.height && current > 0) {
    return -Math.min(EDGE_AUTOSCROLL_LINES, current);
  }
  return 0;
}

function isInsideTranscript(
  event: TranscriptMouseEvent,
  geometry: TranscriptViewportGeometry,
): boolean {
  return (
    event.x >= geometry.x &&
    event.x < geometry.x + geometry.width &&
    event.y >= geometry.y &&
    event.y < geometry.y + geometry.height
  );
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function buttonFromCode(code: number): TranscriptMouseButton {
  if ((code & 64) === 64) return (code & 1) === 1 ? "wheel-down" : "wheel-up";
  if ((code & 3) === 0 || (code & 3) === 3) return "left";
  return "other";
}

function actionFromCode(code: number, releaseSuffix: boolean): TranscriptMouseAction {
  if ((code & 64) === 64) return "wheel";
  if (releaseSuffix || (code & 3) === 3) return "up";
  if ((code & 32) === 32) return "drag";
  return "down";
}
