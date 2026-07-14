import { appendFile, mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { isNodeErrorWithCode } from "@linghun/shared";

export type JsonlReadResult<T> = {
  records: T[];
  diagnostics: JsonlDiagnostic[];
};

export type JsonlDiagnostic = {
  line: number;
  message: string;
};

export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readJsonl<T>(filePath: string): Promise<JsonlReadResult<T>> {
  const exists = await fileExists(filePath);
  if (!exists) {
    return { records: [], diagnostics: [] };
  }

  const text = await readFile(filePath, "utf8");
  const records: T[] = [];
  const diagnostics: JsonlDiagnostic[] = [];

  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) {
      return;
    }

    try {
      records.push(JSON.parse(line) as T);
    } catch (error) {
      diagnostics.push({
        line: index + 1,
        message: error instanceof Error ? error.message : "无法解析 JSONL 行。",
      });
    }
  });

  return { records, diagnostics };
}

export type JsonlTailReadOptions<T> = {
  limit: number;
  maxBytes?: number;
  maxLineBytes?: number;
  maxDiagnostics?: number;
  predicate?: (record: T) => boolean;
  stopPredicate?: (record: T) => boolean;
};

export async function readJsonlTail<T>(
  filePath: string,
  options: JsonlTailReadOptions<T>,
): Promise<JsonlReadResult<T>> {
  const exists = await fileExists(filePath);
  if (!exists || options.limit <= 0) {
    return { records: [], diagnostics: [] };
  }

  const recordsNewestFirst: T[] = [];
  const diagnostics: JsonlDiagnostic[] = [];
  const maxBytes = normalizeOptionalPositiveInteger(options.maxBytes);
  const maxLineBytes = normalizeOptionalPositiveInteger(options.maxLineBytes);
  const maxDiagnostics = normalizeOptionalPositiveInteger(options.maxDiagnostics) ?? 100;
  let omittedDiagnostics = 0;
  let stopped = false;
  const addDiagnostic = (diagnostic: JsonlDiagnostic) => {
    if (diagnostics.length < maxDiagnostics) {
      diagnostics.push(diagnostic);
    } else {
      omittedDiagnostics += 1;
    }
  };
  const handleLine = (lineBuffer: Buffer) => {
    if (recordsNewestFirst.length >= options.limit || stopped) {
      return;
    }
    if (maxLineBytes !== undefined && lineBuffer.length > maxLineBytes) {
      addDiagnostic({
        line: 0,
        message: `jsonl_line_oversized: skipped line larger than ${maxLineBytes} bytes`,
      });
      return;
    }
    const line = lineBuffer.toString("utf8");
    if (!line.trim()) {
      return;
    }
    try {
      const record = JSON.parse(line) as T;
      if (!options.predicate || options.predicate(record)) {
        recordsNewestFirst.push(record);
      }
      if (options.stopPredicate?.(record)) stopped = true;
    } catch (error) {
      addDiagnostic({
        line: 0,
        message: error instanceof Error ? error.message : "无法解析 JSONL 行。",
      });
    }
  };

  const file = await open(filePath, "r");
  try {
    const { size } = await file.stat();
    const chunkSize = 64 * 1024;
    const minimumPosition = maxBytes === undefined ? 0 : Math.max(0, size - maxBytes);
    let position = size;
    let carry = Buffer.alloc(0);
    let discardingOversizedLine = false;

    while (
      position > minimumPosition &&
      recordsNewestFirst.length < options.limit &&
      !stopped
    ) {
      const readSize = Math.min(chunkSize, position - minimumPosition);
      position -= readSize;
      const chunk = Buffer.allocUnsafe(readSize);
      await file.read(chunk, 0, readSize, position);
      const data = carry.length === 0 ? chunk : Buffer.concat([chunk, carry]);
      let lineEnd = data.length;

      if (discardingOversizedLine) {
        let oversizedBoundary = -1;
        for (let index = data.length - 1; index >= 0; index -= 1) {
          if (data[index] === 0x0a) {
            oversizedBoundary = index;
            break;
          }
        }
        if (oversizedBoundary < 0) {
          carry = Buffer.alloc(0);
          continue;
        }
        discardingOversizedLine = false;
        lineEnd = oversizedBoundary;
      }

      for (let index = lineEnd - 1; index >= 0; index -= 1) {
        if (data[index] !== 0x0a) {
          continue;
        }
        handleLine(data.subarray(index + 1, lineEnd));
        lineEnd = index;
        if (recordsNewestFirst.length >= options.limit || stopped) {
          break;
        }
      }

      const nextCarry = data.subarray(0, lineEnd);
      if (maxLineBytes !== undefined && nextCarry.length > maxLineBytes) {
        addDiagnostic({
          line: 0,
          message: `jsonl_line_oversized: skipped line larger than ${maxLineBytes} bytes`,
        });
        carry = Buffer.alloc(0);
        discardingOversizedLine = true;
      } else {
        carry = nextCarry;
      }
    }

    if (
      position === 0 &&
      recordsNewestFirst.length < options.limit &&
      !stopped &&
      !discardingOversizedLine &&
      carry.length > 0
    ) {
      handleLine(carry);
    }
    if (minimumPosition > 0 && position === minimumPosition && !stopped) {
      addDiagnostic({
        line: 0,
        message: `jsonl_tail_truncated: scanned the newest ${maxBytes} bytes; older data was omitted`,
      });
    }
  } finally {
    await file.close();
  }

  if (omittedDiagnostics > 0 && maxDiagnostics > 0) {
    const replacedDiagnosticCount = diagnostics.length >= maxDiagnostics ? 1 : 0;
    const summary = {
      line: 0,
      message: `jsonl_diagnostics_truncated: omitted ${omittedDiagnostics + replacedDiagnosticCount} additional diagnostics`,
    };
    if (diagnostics.length < maxDiagnostics) {
      diagnostics.push(summary);
    } else {
      diagnostics[maxDiagnostics - 1] = summary;
    }
  }

  return { records: recordsNewestFirst.reverse(), diagnostics };
}

function normalizeOptionalPositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.max(1, Math.floor(value));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}
