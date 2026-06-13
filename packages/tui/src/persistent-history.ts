import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { dirname } from "node:path";

export type HistoryEntry = { text: string; timestamp: number };

export type PersistentHistoryOptions = {
  filePath: string;
  maxEntries?: number;
  maxFileLines?: number;
  trimTarget?: number;
};

export type PersistentHistory = {
  load(): Promise<HistoryEntry[]>;
  append(text: string): Promise<void>;
  search(query: string): HistoryEntry[];
  getEntries(): HistoryEntry[];
};

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_FILE_LINES = 10000;
const DEFAULT_TRIM_TARGET = 5000;

export function createPersistentHistory(options: PersistentHistoryOptions): PersistentHistory {
  const {
    filePath,
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxFileLines = DEFAULT_MAX_FILE_LINES,
    trimTarget = DEFAULT_TRIM_TARGET,
  } = options;

  let entries: HistoryEntry[] = [];

  async function load(): Promise<HistoryEntry[]> {
    try {
      await stat(filePath);
    } catch {
      entries = [];
      return entries;
    }

    const loaded = await readTail(filePath, maxEntries);
    entries = loaded;
    return entries;
  }

  async function append(text: string): Promise<void> {
    const entry: HistoryEntry = { text, timestamp: Date.now() };
    entries.push(entry);

    await mkdir(dirname(filePath), { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    const fh = await open(filePath, "a");
    try {
      await fh.write(line);
    } finally {
      await fh.close();
    }

    await trimIfNeeded(filePath, maxFileLines, trimTarget);
  }

  function search(query: string): HistoryEntry[] {
    const lower = query.toLowerCase();
    const matches: HistoryEntry[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].text.toLowerCase().includes(lower)) {
        matches.push(entries[i]);
      }
    }
    return matches;
  }

  function getEntries(): HistoryEntry[] {
    return entries;
  }

  return { load, append, search, getEntries };
}

async function readTail(filePath: string, maxEntries: number): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [];

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  // Collect into a ring buffer to keep only the last maxEntries
  const ring: string[] = [];
  let ringIdx = 0;
  let filled = false;

  for await (const line of rl) {
    if (!line.trim()) continue;
    ring[ringIdx] = line;
    ringIdx++;
    if (ringIdx >= maxEntries) {
      ringIdx = 0;
      filled = true;
    }
  }

  // Reconstruct in order from the ring buffer
  const count = filled ? maxEntries : ringIdx;
  const startIdx = filled ? ringIdx : 0;
  for (let i = 0; i < count; i++) {
    const idx = (startIdx + i) % maxEntries;
    const raw = ring[idx];
    const parsed = parseLine(raw);
    if (parsed) entries.push(parsed);
  }

  return entries;
}

function parseLine(line: string): HistoryEntry | null {
  try {
    const obj = JSON.parse(line);
    if (typeof obj.text === "string" && typeof obj.timestamp === "number") {
      return { text: obj.text, timestamp: obj.timestamp };
    }
    return null;
  } catch {
    return null;
  }
}

async function trimIfNeeded(
  filePath: string,
  maxFileLines: number,
  trimTarget: number,
): Promise<void> {
  let lineCount = 0;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const _ of rl) {
    lineCount++;
    if (lineCount > maxFileLines) break;
  }

  if (lineCount <= maxFileLines) return;

  // Re-read and keep only the last trimTarget lines
  const keepLines: string[] = [];
  const stream2 = createReadStream(filePath, { encoding: "utf8" });
  const rl2 = createInterface({ input: stream2, crlfDelay: Infinity });

  const ring: string[] = [];
  let ringIdx = 0;
  let filled = false;

  for await (const line of rl2) {
    if (!line.trim()) continue;
    ring[ringIdx] = line;
    ringIdx++;
    if (ringIdx >= trimTarget) {
      ringIdx = 0;
      filled = true;
    }
  }

  const count = filled ? trimTarget : ringIdx;
  const startIdx = filled ? ringIdx : 0;
  for (let i = 0; i < count; i++) {
    keepLines.push(ring[(startIdx + i) % trimTarget]);
  }

  await writeFile(filePath, keepLines.join("\n") + "\n", "utf8");
}
