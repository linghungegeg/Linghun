import type { ProductBlockViewModel, TranscriptScrollView } from "../types.js";

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

export function buildTranscriptTextRows(blocks: ProductBlockViewModel[]): TranscriptTextRow[] {
  const rows: TranscriptTextRow[] = [];
  for (const block of blocks) {
    const body = block.fullText ?? block.summary ?? block.title ?? "";
    const lines = body.replace(/\r/g, "").split("\n");
    for (let lineInBlock = 0; lineInBlock < lines.length; lineInBlock++) {
      rows.push({
        index: rows.length,
        blockId: block.id,
        lineInBlock,
        text: lines[lineInBlock] ?? "",
      });
    }
    if (body.trim().length > 0) rows.push({ index: rows.length, text: "" });
  }
  if (rows.length > 0 && rows.at(-1)?.text === "") rows.pop();
  return rows;
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
  if (!isInsideTranscriptX(event.x, geometry)) {
    if (input.state?.dragging && event.action === "up") return { state: undefined, consumed: true };
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
    if (selectionContainsRow(selection, row.index)) selected.add(row.lineInBlock);
  }
  return [...selected].sort((a, b) => a - b);
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
  return selected
    .map((row, index) => {
      if (selected.length === 1)
        return sliceColumns(row.text, range.start.column, range.end.column);
      if (index === 0) return sliceColumns(row.text, range.start.column, undefined);
      if (index === selected.length - 1) return sliceColumns(row.text, 0, range.end.column);
      return row.text;
    })
    .join("\n");
}

function orderedPoints(
  a: TranscriptSelectionPoint,
  b: TranscriptSelectionPoint,
): { start: TranscriptSelectionPoint; end: TranscriptSelectionPoint } {
  if (a.row < b.row) return { start: a, end: b };
  if (a.row > b.row) return { start: b, end: a };
  return a.column <= b.column ? { start: a, end: b } : { start: b, end: a };
}

function sliceColumns(text: string, start: number, end: number | undefined): string {
  const chars = Array.from(text);
  return chars.slice(Math.max(0, start), end === undefined ? undefined : Math.max(0, end)).join("");
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
    Array.from(rows[row]?.text ?? "").length,
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
  if (y < geometry.y && current < maxOffset) return EDGE_AUTOSCROLL_LINES;
  if (y >= geometry.y + geometry.height && current > 0) return -EDGE_AUTOSCROLL_LINES;
  return 0;
}

function isInsideTranscriptX(x: number, geometry: TranscriptViewportGeometry): boolean {
  return x >= geometry.x && x < geometry.x + geometry.width;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function buttonFromCode(code: number): TranscriptMouseButton {
  if ((code & 64) === 64) return (code & 1) === 1 ? "wheel-down" : "wheel-up";
  if ((code & 3) === 0) return "left";
  return "other";
}

function actionFromCode(code: number, releaseSuffix: boolean): TranscriptMouseAction {
  if ((code & 64) === 64) return "wheel";
  if (releaseSuffix || (code & 3) === 3) return "up";
  if ((code & 32) === 32) return "drag";
  return "down";
}
