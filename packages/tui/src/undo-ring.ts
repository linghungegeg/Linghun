import type { EditBuffer } from "./shell/components/Composer.js";

export type UndoRing = {
  entries: EditBuffer[];
  pointer: number;
  maxSize: number;
  lastPushTime: number;
  debounceMs: number;
};

export function createUndoRing(maxSize = 50, debounceMs = 500): UndoRing {
  return {
    entries: [],
    pointer: 0,
    maxSize,
    lastPushTime: 0,
    debounceMs,
  };
}

export function undoRingPush(
  ring: UndoRing,
  buffer: EditBuffer,
  now: number = Date.now(),
): UndoRing {
  const withinDebounce = ring.entries.length > 0 && now - ring.lastPushTime < ring.debounceMs;

  if (withinDebounce) {
    // Overwrite current entry (coalesce rapid edits)
    const entries = [...ring.entries];
    entries[ring.pointer] = buffer;
    return { ...ring, entries, lastPushTime: now };
  }

  // Advance pointer
  if (ring.entries.length === 0) {
    return {
      ...ring,
      entries: [buffer],
      pointer: 0,
      lastPushTime: now,
    };
  }

  const nextPointer = (ring.pointer + 1) % ring.maxSize;
  const entries = [...ring.entries];

  if (entries.length < ring.maxSize) {
    // Ring not full yet — append
    entries.push(buffer);
  } else {
    // Ring full — overwrite at next position
    entries[nextPointer] = buffer;
  }

  return {
    ...ring,
    entries,
    pointer: nextPointer,
    lastPushTime: now,
  };
}

export function undoRingPop(ring: UndoRing): { ring: UndoRing; buffer: EditBuffer | undefined } {
  if (ring.entries.length <= 1) {
    // Nothing to undo to
    return { ring, buffer: undefined };
  }

  const prevPointer = ring.pointer === 0 ? ring.entries.length - 1 : ring.pointer - 1;
  const buffer = ring.entries[prevPointer];

  return {
    ring: { ...ring, pointer: prevPointer },
    buffer,
  };
}

export function undoRingReset(ring: UndoRing): UndoRing {
  return {
    ...ring,
    entries: [],
    pointer: 0,
    lastPushTime: 0,
  };
}
