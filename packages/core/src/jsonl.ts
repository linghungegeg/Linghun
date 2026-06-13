import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
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
