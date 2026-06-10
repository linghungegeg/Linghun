export type TerminalSelectionMouseButton = "left" | "wheel-up" | "wheel-down" | "other";

export type TerminalSelectionMouseAction = "down" | "drag" | "up" | "wheel" | "hover" | "focus-out";

export type TerminalSelectionMouseEvent = {
  x: number;
  y: number;
  button: TerminalSelectionMouseButton;
  action: TerminalSelectionMouseAction;
};

export type TerminalSelectionViewportGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  contentHeight: number;
  topOffset: number;
};

export type TerminalSelectionCell = {
  char: string;
  selectableText: string;
  width: number;
  noSelect?: boolean;
};

export type TerminalSelectionTextRow = {
  index: number;
  blockId?: string;
  lineInBlock?: number;
  text: string;
  cells: TerminalSelectionCell[];
  sourceColumnStart?: number;
  softWrapped?: boolean;
  noSelect?: boolean;
};

export type TerminalSelectionPoint = {
  row: number;
  column: number;
};

export type TerminalSelectionState = {
  dragging: boolean;
  anchor?: TerminalSelectionPoint;
  focus?: TerminalSelectionPoint;
  selectedText?: string;
  copiedText?: string;
  lastCopyError?: string;
  anchorMode?: "char" | "word" | "line";
  lastClickTime?: number;
  lastClickRow?: number;
  clickCount?: number;
  moved?: boolean;
};

export type TerminalSelectionInput = {
  state: TerminalSelectionState | undefined;
  event: TerminalSelectionMouseEvent;
  rows: TerminalSelectionTextRow[];
  geometry?: TerminalSelectionViewportGeometry;
  scroll?: {
    scrollOffset: number;
    stickToBottom: boolean;
    viewportHeight?: number;
    contentHeight?: number;
  };
  copyOnSelect?: boolean;
  now?: number;
};

export type TerminalSelectionResult = {
  state: TerminalSelectionState | undefined;
  copyText?: string;
  scrollDelta?: number;
  consumed: boolean;
};

export type TerminalSelectionLineRange = {
  lineIndex: number;
  startColumn: number;
  endColumn: number;
};

const EDGE_AUTOSCROLL_LINES = 2;
const MULTI_CLICK_TIMEOUT_MS = 500;
const LOST_RELEASE_TIMEOUT_MS = 5000;
const SGR_MOUSE_RE = /^?\[<(\d+);(\d+);(\d+)([mM])$/u;

export function parseTerminalSelectionMouseEvent(input: string): TerminalSelectionMouseEvent | undefined {
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

export function isTerminalSelectionMouseInput(input: string): boolean {
  return SGR_MOUSE_RE.test(input);
}

export function isTerminalSelectionStale(state: TerminalSelectionState | undefined, now: number): boolean {
  if (!state?.dragging || !state.lastClickTime) return false;
  return now - state.lastClickTime > LOST_RELEASE_TIMEOUT_MS;
}

export function reduceTerminalSelection(input: TerminalSelectionInput): TerminalSelectionResult {
  const { event, geometry, rows } = input;
  const copyOnSelect = input.copyOnSelect !== false;
  if (event.action === "focus-out") return finishLostRelease(input, copyOnSelect);
  if (!geometry || rows.length === 0) return { state: input.state, consumed: false };
  if (event.button !== "left" && event.button !== "wheel-up" && event.button !== "wheel-down") {
    return { state: input.state, consumed: false };
  }
  if (event.action === "wheel") return { state: input.state, consumed: false };
  if (event.action === "hover") return input.state?.dragging ? finishLostRelease(input, copyOnSelect) : { state: input.state, consumed: false };
  if (!isInsideTranscript(event, geometry)) {
    if (input.state?.dragging && (event.action === "drag" || event.action === "up")) {
      return finishOrUpdateOutOfBoundsDrag(input, copyOnSelect);
    }
    return { state: input.state, consumed: false };
  }

  const point = pointFromMouse(event, geometry, rows);
  const scrollDelta =
    event.action === "drag" && input.state?.dragging
      ? autoScrollDeltaForMouse(event.y, geometry, input.scroll)
      : 0;

  if (event.action === "down") {
    const now = input.now ?? Date.now();
    const clickCount = detectClickCount(input.state, point, now);
    const targetRow = rows[point.row];
    const lostReleaseCopy = finishPreviousDragForFreshPress(input.state, rows, copyOnSelect);

    if (clickCount === 2 && targetRow && !targetRow.noSelect) {
      const bounds = wordBoundsAt(targetRow, point.column);
      const anchor: TerminalSelectionPoint = { row: point.row, column: bounds.start };
      const focus: TerminalSelectionPoint = { row: point.row, column: bounds.end };
      const next: TerminalSelectionState = {
        dragging: true,
        anchor,
        focus,
        anchorMode: "word",
        lastClickTime: now,
        lastClickRow: point.row,
        clickCount,
        moved: true,
      };
      return { state: withSelectedText(next, rows), copyText: lostReleaseCopy, consumed: true };
    }
    if (clickCount === 3 && targetRow && !targetRow.noSelect) {
      const anchor: TerminalSelectionPoint = { row: point.row, column: 0 };
      const focus: TerminalSelectionPoint = { row: point.row, column: targetRow.cells.length };
      const next: TerminalSelectionState = {
        dragging: true,
        anchor,
        focus,
        anchorMode: "line",
        lastClickTime: now,
        lastClickRow: point.row,
        clickCount,
        moved: true,
      };
      return { state: withSelectedText(next, rows), copyText: lostReleaseCopy, consumed: true };
    }

    const next: TerminalSelectionState = {
      dragging: true,
      anchor: point,
      focus: point,
      anchorMode: "char",
      lastClickTime: now,
      lastClickRow: point.row,
      clickCount,
      moved: false,
    };
    return { state: withSelectedText(next, rows), copyText: lostReleaseCopy, consumed: true };
  }

  if (event.action === "drag") {
    if (!input.state?.dragging || !input.state.anchor) return { state: input.state, consumed: true };
    let adjustedFocus = point;
    if (input.state.anchorMode === "word") {
      const targetRow = rows[point.row];
      if (targetRow && !targetRow.noSelect) {
        const bounds = wordBoundsAt(targetRow, point.column);
        adjustedFocus = { row: point.row, column: point.row >= input.state.anchor.row ? bounds.end : bounds.start };
      }
    } else if (input.state.anchorMode === "line") {
      const targetRow = rows[point.row];
      if (targetRow) {
        adjustedFocus = { row: point.row, column: point.row >= input.state.anchor.row ? targetRow.cells.length : 0 };
      }
    }
    const next: TerminalSelectionState = {
      ...input.state,
      dragging: true,
      focus: adjustedFocus,
      lastCopyError: undefined,
      moved: input.state.moved || input.state.anchor.row !== adjustedFocus.row || input.state.anchor.column !== adjustedFocus.column,
    };
    return {
      state: withSelectedText(next, rows),
      scrollDelta,
      consumed: true,
    };
  }

  if (event.action === "up") {
    if (!input.state?.dragging || !input.state.anchor) return { state: undefined, consumed: true };
    const moved = input.state.moved || input.state.anchor.row !== point.row || input.state.anchor.column !== point.column;
    const next = withSelectedText({ ...input.state, dragging: false, focus: point, moved }, rows);
    return settleSelection(next, rows, copyOnSelect);
  }

  return { state: input.state, consumed: false };
}

export function terminalSelectionContainsRow(
  selection: TerminalSelectionState | undefined,
  rowIndex: number,
): boolean {
  if (!selection?.anchor || !selection.focus) return false;
  const range = orderedPoints(selection.anchor, selection.focus);
  return rowIndex >= range.start.row && rowIndex <= range.end.row;
}

export function terminalSelectionLineIndexesForBlock(
  selection: TerminalSelectionState | undefined,
  rows: TerminalSelectionTextRow[],
  blockId: string,
): number[] {
  if (!selection?.anchor || !selection.focus) return [];
  const selected = new Set<number>();
  for (const row of rows) {
    if (row.blockId !== blockId || row.lineInBlock === undefined) continue;
    if (row.noSelect) continue;
    if (terminalSelectionContainsRow(selection, row.index)) selected.add(row.lineInBlock);
  }
  return [...selected].sort((a, b) => a - b);
}

export function terminalSelectionLineRangesForBlock(
  selection: TerminalSelectionState | undefined,
  rows: TerminalSelectionTextRow[],
  blockId: string,
): TerminalSelectionLineRange[] {
  if (!selection?.anchor || !selection.focus) return [];
  const range = orderedPoints(selection.anchor, selection.focus);
  const selectedRows = rows.slice(range.start.row, range.end.row + 1);
  const ranges: TerminalSelectionLineRange[] = [];
  for (let index = 0; index < selectedRows.length; index++) {
    const row = selectedRows[index];
    if (!row || row.noSelect || row.blockId !== blockId || row.lineInBlock === undefined) continue;
    const start = selectedRows.length === 1 || index === 0 ? Math.max(0, range.start.column) : 0;
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

export function terminalSelectedTextFromRows(
  rows: TerminalSelectionTextRow[],
  anchor: TerminalSelectionPoint,
  focus: TerminalSelectionPoint,
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

function finishPreviousDragForFreshPress(
  state: TerminalSelectionState | undefined,
  rows: TerminalSelectionTextRow[],
  copyOnSelect: boolean,
): string | undefined {
  if (!copyOnSelect || !state?.dragging || !state.anchor) return undefined;
  const finished = withSelectedText({ ...state, dragging: false }, rows);
  return copyableText(finished);
}

function finishLostRelease(input: TerminalSelectionInput, copyOnSelect: boolean): TerminalSelectionResult {
  if (!input.state?.dragging || !input.state.anchor) return { state: input.state, consumed: false };
  const next = withSelectedText({ ...input.state, dragging: false }, input.rows);
  return settleSelection(next, input.rows, copyOnSelect);
}

function finishOrUpdateOutOfBoundsDrag(input: TerminalSelectionInput, copyOnSelect: boolean): TerminalSelectionResult {
  const { event, geometry, rows } = input;
  if (!geometry || !input.state?.anchor || rows.length === 0) return { state: undefined, consumed: true };
  const point = pointFromMouse(event, geometry, rows);
  if (event.action === "drag") {
    const next = withSelectedText({ ...input.state, dragging: true, focus: point, moved: true }, rows);
    return {
      state: next,
      scrollDelta: autoScrollDeltaForMouse(event.y, geometry, input.scroll),
      consumed: true,
    };
  }
  const next = withSelectedText({ ...input.state, dragging: false, focus: point, moved: true }, rows);
  return settleSelection(next, rows, copyOnSelect);
}

function settleSelection(
  next: TerminalSelectionState,
  rows: TerminalSelectionTextRow[],
  copyOnSelect: boolean,
): TerminalSelectionResult {
  if (!copyOnSelect) return { state: next, consumed: true };
  const copyText = copyableText(next);
  if (!copyText) {
    return {
      state: {
        dragging: false,
        lastClickTime: next.lastClickTime,
        lastClickRow: next.lastClickRow,
        clickCount: next.clickCount,
      },
      consumed: true,
    };
  }
  return {
    state: { ...next, copiedText: copyText },
    copyText,
    consumed: true,
  };
}

function copyableText(state: TerminalSelectionState): string | undefined {
  if (state.anchorMode === "char" && !state.moved) return undefined;
  const text = state.selectedText?.trimEnd();
  if (!text || text.trim().length === 0) return undefined;
  return text;
}

function detectClickCount(state: TerminalSelectionState | undefined, point: TerminalSelectionPoint, now: number): number {
  if (!state?.lastClickTime || state.lastClickRow === undefined) return 1;
  if (now - state.lastClickTime > MULTI_CLICK_TIMEOUT_MS) return 1;
  if (state.lastClickRow !== point.row) return 1;
  return ((state.clickCount ?? 1) % 3) + 1;
}

function wordBoundsAt(row: TerminalSelectionTextRow, column: number): { start: number; end: number } {
  const cells = row.cells.length > 0 ? row.cells : cellsFromText(row.text, row.noSelect === true);
  const col = Math.max(0, Math.min(column, cells.length - 1));
  const charAtCol = cells[col]?.selectableText ?? " ";
  const cls = charClass(charAtCol);
  let start = col;
  while (start > 0 && charClass(cells[start - 1]?.selectableText ?? " ") === cls) start--;
  let end = col;
  while (end < cells.length - 1 && charClass(cells[end + 1]?.selectableText ?? " ") === cls) end++;
  return { start, end: end + 1 };
}

function charClass(ch: string): "ws" | "word" | "punct" {
  if (/\s/.test(ch)) return "ws";
  if (/[\w一-鿿㐀-䶿豈-﫿]/.test(ch)) return "word";
  return "punct";
}

function withSelectedText(
  state: TerminalSelectionState,
  rows: TerminalSelectionTextRow[],
): TerminalSelectionState {
  if (!state.anchor || !state.focus) return state;
  return { ...state, selectedText: terminalSelectedTextFromRows(rows, state.anchor, state.focus) };
}

function orderedPoints(
  a: TerminalSelectionPoint,
  b: TerminalSelectionPoint,
): { start: TerminalSelectionPoint; end: TerminalSelectionPoint } {
  if (a.row < b.row) return { start: a, end: b };
  if (a.row > b.row) return { start: b, end: a };
  return a.column <= b.column ? { start: a, end: b } : { start: b, end: a };
}

function sliceRowCells(row: TerminalSelectionTextRow, start: number, end: number | undefined): string {
  const cells = row.cells.length > 0 ? row.cells : cellsFromText(row.text, row.noSelect === true);
  return cells
    .slice(Math.max(0, start), end === undefined ? undefined : Math.max(0, end))
    .map((cell) => (cell.noSelect ? "" : cell.selectableText))
    .join("");
}

function selectableTextFromRow(row: TerminalSelectionTextRow): string {
  return sliceRowCells(row, 0, undefined);
}

function cellsFromText(text: string, noSelect: boolean): TerminalSelectionCell[] {
  return Array.from(text).map((char) => ({ char, selectableText: noSelect ? "" : char, width: 1, noSelect }));
}

function pointFromMouse(
  event: TerminalSelectionMouseEvent,
  geometry: TerminalSelectionViewportGeometry,
  rows: TerminalSelectionTextRow[],
): TerminalSelectionPoint {
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
  geometry: TerminalSelectionViewportGeometry,
  scroll: TerminalSelectionInput["scroll"],
): number {
  const maxOffset = Math.max(0, geometry.contentHeight - geometry.height);
  const current = scroll?.scrollOffset ?? 0;
  if (y < geometry.y && current < maxOffset) return Math.min(EDGE_AUTOSCROLL_LINES, maxOffset - current);
  if (y >= geometry.y + geometry.height && current > 0) return -Math.min(EDGE_AUTOSCROLL_LINES, current);
  return 0;
}

function isInsideTranscript(event: TerminalSelectionMouseEvent, geometry: TerminalSelectionViewportGeometry): boolean {
  return event.x >= geometry.x && event.x < geometry.x + geometry.width && event.y >= geometry.y && event.y < geometry.y + geometry.height;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function buttonFromCode(code: number): TerminalSelectionMouseButton {
  if ((code & 64) === 64) return (code & 1) === 1 ? "wheel-down" : "wheel-up";
  if ((code & 3) === 0 || (code & 3) === 3) return "left";
  return "other";
}

function actionFromCode(code: number, releaseSuffix: boolean): TerminalSelectionMouseAction {
  if ((code & 64) === 64) return "wheel";
  if ((code & 32) === 32 && (code & 3) === 3 && !releaseSuffix) return "hover";
  if (releaseSuffix || (code & 3) === 3) return "up";
  if ((code & 32) === 32) return "drag";
  return "down";
}
