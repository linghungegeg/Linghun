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
  let stopped = false;
  const handleLine = (lineBuffer: Buffer) => {
    if (recordsNewestFirst.length >= options.limit || stopped) {
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
      diagnostics.push({
        line: 0,
        message: error instanceof Error ? error.message : "无法解析 JSONL 行。",
      });
    }
  };

  const file = await open(filePath, "r");
  try {
    const { size } = await file.stat();
    const chunkSize = 64 * 1024;
    let position = size;
    let carry = Buffer.alloc(0);

    while (position > 0 && recordsNewestFirst.length < options.limit && !stopped) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const chunk = Buffer.allocUnsafe(readSize);
      await file.read(chunk, 0, readSize, position);
      const data = carry.length === 0 ? chunk : Buffer.concat([chunk, carry]);
      let lineEnd = data.length;

      for (let index = data.length - 1; index >= 0; index -= 1) {
        if (data[index] !== 0x0a) {
          continue;
        }
        handleLine(data.subarray(index + 1, lineEnd));
        lineEnd = index;
        if (recordsNewestFirst.length >= options.limit || stopped) {
          break;
        }
      }

      carry = data.subarray(0, lineEnd);
    }

    if (
      position === 0 &&
      recordsNewestFirst.length < options.limit &&
      !stopped &&
      carry.length > 0
    ) {
      handleLine(carry);
    }
  } finally {
    await file.close();
  }

  return { records: recordsNewestFirst.reverse(), diagnostics };
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
